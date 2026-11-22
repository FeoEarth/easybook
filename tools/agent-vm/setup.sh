#!/data/data/com.termux/files/usr/bin/bash
# Trusted, bundled Easybook VM provisioner. Not model-generated code.
set -euo pipefail
umask 077
DIR="$HOME/easybook-agent-vm"
mkdir -p "$DIR"
[[ "$(uname -m)" == "aarch64" ]] || { echo "Only Android ARM64 is supported"; exit 65; }
LOCK="$DIR/.install-lock"
mkdir "$LOCK" 2>/dev/null || { echo "An installation is already active"; exit 73; }
finish() {
  rc=$?
  trap - EXIT
  if ((rc!=0)); then printf 'failed\n' > "$DIR/install.state"; fi
  rmdir "$LOCK" 2>/dev/null || true
  exit "$rc"
}
trap finish EXIT
stage() { printf '%s\n' "$1" > "$DIR/install.state"; printf '[Easybook] %s\n' "$1"; }
exec >> "$DIR/install.log" 2>&1
if [[ -f "$DIR/.installed" && -f "$DIR/guest.qcow2" && -f "$DIR/seed.iso" ]]; then
  stage installed
  exit 0
fi
if [[ -e "$DIR/guest.qcow2" ]]; then
  echo "Existing unrecognized guest image; refusing overwrite"; exit 74
fi
# Termux's own signed package repository supplies all host executables.
stage packages
pkg update -y
pkg install -y openssh coreutils curl qemu-system-aarch64-headless qemu-utils xorriso
for cmd in curl ssh ssh-keygen qemu-img qemu-system-aarch64 xorriso sha512sum; do
  command -v "$cmd" >/dev/null || { echo "Missing package: $cmd"; exit 66; }
done
FIRMWARE="$PREFIX/share/qemu/edk2-aarch64-code.fd"
[[ -s "$FIRMWARE" ]] || { echo "Termux ARM64 UEFI firmware missing"; exit 66; }
available=$(df -Pk "$HOME" | awk 'END { print $4+0 }')
((available>=1500000)) || { echo "At least 1.5 GB free storage is required"; exit 75; }
stage downloading
# Immutable Debian 13 (trixie) official cloud image. SHA-512 pinned in the APK.
IMAGE="debian-13-genericcloud-arm64-20260623-2518.qcow2"
URL="https://cloud.debian.org/cdimage/cloud/trixie/20260623-2518/$IMAGE"
SHA512="fd35e5ec7bd31bc3821ba43135574ac42bdf0ded4dc6e3c8a86995e00b4206db60f2a7782bb9d94188f2b302df782d3afb5b13bdeaba25efe8c39bc51cec83a8"
TMP="$DIR/guest.download"
if [[ -f "$TMP" ]]; then
  printf '%s  %s\n' "$SHA512" "$TMP" | sha512sum -c - >/dev/null 2>&1 || rm -f "$TMP"
fi
if [[ ! -f "$TMP" ]]; then
  curl --fail --location --retry 3 --connect-timeout 15 --proto '=https' --tlsv1.2 -o "$TMP" "$URL"
fi
printf '%s  %s\n' "$SHA512" "$TMP" | sha512sum -c -
qemu-img info -f qcow2 "$TMP" >/dev/null
stage provisioning
mkdir -p "$DIR/ssh" "$DIR/seed"
chmod 700 "$DIR/ssh"
[[ -f "$DIR/ssh/id_ed25519" ]] || ssh-keygen -q -t ed25519 -f "$DIR/ssh/id_ed25519" -N ''
[[ -f "$DIR/ssh/guest_host" ]] || ssh-keygen -q -t ed25519 -f "$DIR/ssh/guest_host" -N ''
chmod 600 "$DIR/ssh/id_ed25519" "$DIR/ssh/guest_host"
printf '[127.0.0.1]:2222 %s\n' "$(cat "$DIR/ssh/guest_host.pub")" > "$DIR/ssh/known_hosts"
chmod 600 "$DIR/ssh/known_hosts"
cat > "$DIR/seed/meta-data" <<'META'
instance-id: easybook-agent-debian13-v1
local-hostname: easybook-agent
META
cat > "$DIR/seed/user-data" <<'USERDATA'
#cloud-config
hostname: easybook-agent
manage_etc_hosts: true
disable_root: true
ssh_pwauth: false
ssh_deletekeys: true
ssh_genkeytypes: []
users:
  - name: easybook
    shell: /bin/bash
    lock_passwd: true
    sudo: null
    ssh_authorized_keys:
USERDATA
printf '      - %s\n' "$(cat "$DIR/ssh/id_ed25519.pub")" >> "$DIR/seed/user-data"
cat >> "$DIR/seed/user-data" <<'USERDATA'
ssh_keys:
  ed25519_private: |
USERDATA
sed 's/^/    /' "$DIR/ssh/guest_host" >> "$DIR/seed/user-data"
printf '  ed25519_public: %s\n' "$(cat "$DIR/ssh/guest_host.pub")" >> "$DIR/seed/user-data"
cat >> "$DIR/seed/user-data" <<'USERDATA'
package_update: false
packages:
  - openssh-server
  - python3
runcmd:
  - [systemctl, enable, --now, ssh]
USERDATA
(
  cd "$DIR/seed"
  xorriso -as mkisofs -quiet -V cidata -o "$DIR/seed.iso" user-data meta-data
)
[[ -s "$DIR/seed.iso" ]] || { echo "cloud-init seed creation failed"; exit 70; }
cp "$FIRMWARE" "$DIR/QEMU_EFI.fd"
mv "$TMP" "$DIR/guest.qcow2"
qemu-img resize -f qcow2 "$DIR/guest.qcow2" 6G
touch "$DIR/.installed"
stage installed
echo "Easybook Linux guest image and SSH identities provisioned"

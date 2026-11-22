#!/data/data/com.termux/files/usr/bin/bash
# Expert-only example: boot a pre-provisioned Linux ARM64 disk with QEMU TCG.
# This script DOES NOT download OS images or grant Easybook access to Termux.
set -euo pipefail
DIR="$HOME/easybook-agent-vm"
DISK="$DIR/guest.qcow2"
FIRMWARE="$DIR/QEMU_EFI.fd"
SEED="$DIR/seed.iso"
[[ -f "$DISK" && -f "$FIRMWARE" && -f "$SEED" ]] || {
  echo 'Place a trusted pre-installed Linux ARM64 qcow2 at guest.qcow2 and UEFI firmware at QEMU_EFI.fd' >&2
  exit 65
}
command -v qemu-system-aarch64 >/dev/null || {
  echo 'Install qemu-system-aarch64-headless in Termux' >&2; exit 66
}
# No 9p/virtiofs passthrough, no shared clipboard, no host directories, no
# QEMU monitor socket accessible to the Agent. Only guest TCP/22 is forwarded.
exec qemu-system-aarch64 \
  -machine virt -accel tcg -cpu cortex-a72 -smp 2 -m 1024 \
  -bios "$FIRMWARE" \
  -drive file="$DISK",format=qcow2,if=virtio,cache=writeback \
  -device virtio-scsi-device \
  -drive file="$SEED",format=raw,media=cdrom,readonly=on,if=none,id=seed \
  -device scsi-cd,drive=seed \
  -device virtio-net-device,netdev=guestnet \
  -netdev user,id=guestnet,hostfwd=tcp:127.0.0.1:2222-:22 \
  -nographic -no-reboot

#!/data/data/com.termux/files/usr/bin/bash
# Optional Easybook -> QEMU *guest* executor. Install manually to
# ~/easybook-agent-vm/runner.sh (chmod 700). Termux host never evaluates stdin.
set -euo pipefail
umask 077
MODE="${1:-}"
SCOPE="${2:-}"
if [[ "$MODE" != shell && "$MODE" != python ]]; then
  echo 'Unsupported guest language' >&2; exit 64
fi
[[ "$SCOPE" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid guest workspace scope' >&2; exit 64; }
DIR="$HOME/easybook-agent-vm"
KEY="$DIR/ssh/id_ed25519"
KNOWN="$DIR/ssh/known_hosts"
[[ -f "$KEY" && -s "$KNOWN" ]] || { echo 'Guest SSH identity/known_hosts not configured' >&2; exit 65; }
command -v ssh >/dev/null || { echo 'Install openssh in Termux' >&2; exit 66; }
command -v timeout >/dev/null || { echo 'Install coreutils in Termux' >&2; exit 66; }
# No agent text is interpolated into the Termux shell command.
# Only the script's STDIN travels through the authenticated SSH channel.
SSH=(ssh -T -p 2222 -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes
    -o UserKnownHostsFile="$KNOWN" -o GlobalKnownHostsFile=/dev/null
    -o ConnectTimeout=7 -o ConnectionAttempts=1
    -o ClearAllForwardings=yes -o ForwardAgent=no -o ForwardX11=no
    -o PermitLocalCommand=no -o RequestTTY=no
    easybook@127.0.0.1)
if [[ "$MODE" == shell ]]; then
  timeout --signal=TERM --kill-after=3 32 "${SSH[@]}" "umask 077; mkdir -p \"\$HOME/work/$SCOPE\"; cd \"\$HOME/work/$SCOPE\" && exec /bin/bash --noprofile --norc -s"
else
  timeout --signal=TERM --kill-after=3 32 "${SSH[@]}" "umask 077; mkdir -p \"\$HOME/work/$SCOPE\"; cd \"\$HOME/work/$SCOPE\" && exec /usr/bin/python3 -I -"
fi

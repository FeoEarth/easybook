#!/data/data/com.termux/files/usr/bin/bash
# Fixed VM lifecycle helper, invoked only by Easybook's trusted native bridge.
set -euo pipefail
umask 077
DIR="$HOME/easybook-agent-vm"
ACTION="${1:-status}"
running() {
  [[ -r "$DIR/vm.pid" ]] || return 1
  local pid
  read -r pid < "$DIR/vm.pid"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  [[ -r "/proc/$pid/cmdline" ]] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" | grep -Fq "$DIR/guest.qcow2"
}
ready() {
  [[ -r "$DIR/ssh/id_ed25519" && -s "$DIR/ssh/known_hosts" ]] || return 1
  timeout 5 ssh -T -p 2222 -i "$DIR/ssh/id_ed25519" \
    -o BatchMode=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$DIR/ssh/known_hosts" \
    -o GlobalKnownHostsFile=/dev/null -o ConnectTimeout=3 \
    -o ConnectionAttempts=1 -o ClearAllForwardings=yes \
    -o ForwardAgent=no -o ForwardX11=no \
    easybook@127.0.0.1 true </dev/null >/dev/null 2>&1
}
stop_vm() {
  if running; then
    local pid
    read -r pid < "$DIR/vm.pid"
    kill -TERM "$pid"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      running || break
      sleep 0.5
    done
    if running; then echo 'VM did not stop'; exit 70; fi
  fi
  rm -f "$DIR/vm.pid"
}
case "$ACTION" in
  status)
    phase=not-installed
    [[ ! -f "$DIR/install.state" ]] || read -r phase < "$DIR/install.state"
    case "$phase" in packages|downloading|provisioning|installed|failed|not-installed) ;; *) phase=unknown;; esac
    installed=false; up=false; guest=false
    [[ -f "$DIR/.installed" && -f "$DIR/guest.qcow2" && -s "$DIR/seed.iso" ]] && installed=true
    if running; then
      up=true
      if ready; then guest=true; fi
    fi
    printf '{"phase":"%s","installed":%s,"running":%s,"guestReady":%s}\n' "$phase" "$installed" "$up" "$guest"
    ;;
  start)
    [[ -f "$DIR/.installed" && -s "$DIR/seed.iso" && -f "$DIR/guest.qcow2" ]] || { echo 'Linux is not installed'; exit 65; }
    if ! running; then
      rm -f "$DIR/vm.pid"
      nohup "$DIR/start-qemu.sh" >"$DIR/vm.log" 2>&1 </dev/null &
      echo "$!" > "$DIR/vm.pid"
    fi
    echo 'STARTED'
    ;;
  stop)
    stop_vm
    echo 'STOPPED'
    ;;
  remove)
    [[ ! -d "$DIR/.install-lock" ]] || { echo 'Installation in progress'; exit 73; }
    stop_vm
    # The named app-private guest directory is never shared with notes.
    rm -rf -- "$DIR"
    echo 'REMOVED'
    ;;
  *) echo 'Unsupported VM operation'; exit 64;;
esac

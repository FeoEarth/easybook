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
probe_guest() {
  # Return a machine-readable reason, never disclose SSH keys or raw serial logs.
  [[ -r "$DIR/ssh/id_ed25519" && -s "$DIR/ssh/known_hosts" ]] || {
    printf '%s' missing_ssh_keys; return
  }
  local error
  if error=$(timeout 8 ssh -T -p 2222 -i "$DIR/ssh/id_ed25519" \
    -o BatchMode=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$DIR/ssh/known_hosts" \
    -o GlobalKnownHostsFile=/dev/null -o ConnectTimeout=5 \
    -o ConnectionAttempts=1 -o ClearAllForwardings=yes \
    -o ForwardAgent=no -o ForwardX11=no \
    easybook@127.0.0.1 true </dev/null 2>&1); then
    printf '%s' ready; return
  fi
  case "$error" in
    *"REMOTE HOST IDENTIFICATION HAS CHANGED"*|*"Host key verification failed"*) printf '%s' ssh_host_key_mismatch;;
    *"Permission denied"*|*"Authentication failed"*) printf '%s' ssh_auth_failed;;
    *"Connection refused"*) printf '%s' ssh_not_listening;;
    *"Connection timed out"*|*"Operation timed out"*) printf '%s' ssh_timeout;;
    *"Connection closed"*|*"Connection reset"*) printf '%s' ssh_initializing;;
    *"No route to host"*|*"Network is unreachable"*) printf '%s' guest_network_error;;
    *) printf '%s' ssh_unavailable;;
  esac
}
boot_log_issue() {
  [[ -f "$DIR/vm.log" ]] || return
  local log
  log=$(tail -n 100 "$DIR/vm.log")
  if printf '%s' "$log" | grep -Eiq 'Kernel panic|not syncing:|Unable to mount root fs'; then printf '%s' kernel_panic
  elif printf '%s' "$log" | grep -Eiq 'UEFI Interactive Shell|Shell>'; then printf '%s' uefi_boot_shell
  elif printf '%s' "$log" | grep -Eiq 'Could not open|Failed to (open|initialize)|Could not load|failed to create'; then printf '%s' qemu_error
  elif printf '%s' "$log" | grep -Eiq 'cloud-init.*(error|failed)|failed.*cloud-init'; then printf '%s' cloud_init_error
  fi
}
boot_seconds() {
  local start=0 now
  if [[ -r "$DIR/vm.started" ]]; then read -r start < "$DIR/vm.started"
  elif [[ -f "$DIR/vm.pid" ]]; then start=$(stat -c %Y "$DIR/vm.pid" 2>/dev/null || printf 0)
  fi
  [[ "$start" =~ ^[0-9]+$ ]] || start=0
  now=$(date +%s)
  if ((start>0 && now>=start)); then printf '%d' "$((now-start))"; else printf '0'; fi
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
  rm -f "$DIR/vm.pid" "$DIR/vm.started"
}
case "$ACTION" in
  status)
    phase=not-installed
    [[ ! -f "$DIR/install.state" ]] || read -r phase < "$DIR/install.state"
    case "$phase" in packages|downloading|provisioning|installed|failed|not-installed) ;; *) phase=unknown;; esac
    installed=false; up=false; guest=false
    [[ -f "$DIR/.installed" && -f "$DIR/guest.qcow2" && -s "$DIR/seed.iso" ]] && installed=true
    issue=none; seconds=0
    if running; then
      up=true
      seconds=$(boot_seconds)
      issue=$(probe_guest)
      [[ "$issue" != ready ]] || { guest=true; issue=none; }
      if [[ "$issue" != none ]]; then
        logissue=$(boot_log_issue)
        if [[ -n "$logissue" ]]; then issue=$logissue
        elif ((seconds>=600)) && [[ "$issue" == ssh_not_listening || "$issue" == ssh_timeout || "$issue" == ssh_unavailable ]]; then
          issue=boot_too_long
        fi
      fi
    elif [[ -f "$DIR/vm.log" ]]; then
      issue=$(boot_log_issue)
      [[ -n "$issue" ]] || issue=vm_not_running
    fi
    printf '{"phase":"%s","installed":%s,"running":%s,"guestReady":%s,"bootSeconds":%d,"issue":"%s"}\n' "$phase" "$installed" "$up" "$guest" "$seconds" "$issue"
    ;;
  start)
    [[ -f "$DIR/.installed" && -s "$DIR/seed.iso" && -f "$DIR/guest.qcow2" ]] || { echo 'Linux is not installed'; exit 65; }
    if ! running; then
      rm -f "$DIR/vm.pid"
      nohup "$DIR/start-qemu.sh" >"$DIR/vm.log" 2>&1 </dev/null &
      echo "$!" > "$DIR/vm.pid"
      date +%s > "$DIR/vm.started"
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

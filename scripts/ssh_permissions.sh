#!/bin/sh
# Vast may rewrite authorized_keys after startup. Keep OpenSSH's normal strict
# ownership/mode checks working without changing keys or weakening sshd.
recast_fix_ssh_permissions() {
  RECAST_SSH_BASE="${RECAST_SSH_BASE:-/root}"
  RECAST_SSH_OWNER="${RECAST_SSH_OWNER:-0:0}"
  [ -d "$RECAST_SSH_BASE" ] && [ ! -L "$RECAST_SSH_BASE" ] || return 1
  [ ! -L "$RECAST_SSH_BASE/.ssh" ] || return 1
  mkdir -p "$RECAST_SSH_BASE/.ssh" || return 1
  chown "$RECAST_SSH_OWNER" "$RECAST_SSH_BASE" "$RECAST_SSH_BASE/.ssh" || return 1
  chmod go-w "$RECAST_SSH_BASE" || return 1
  chmod 700 "$RECAST_SSH_BASE/.ssh" || return 1
  if [ -e "$RECAST_SSH_BASE/.ssh/authorized_keys" ] || [ -L "$RECAST_SSH_BASE/.ssh/authorized_keys" ]; then
    [ -f "$RECAST_SSH_BASE/.ssh/authorized_keys" ] && [ ! -L "$RECAST_SSH_BASE/.ssh/authorized_keys" ] || return 1
    chown "$RECAST_SSH_OWNER" "$RECAST_SSH_BASE/.ssh/authorized_keys" || return 1
    chmod 600 "$RECAST_SSH_BASE/.ssh/authorized_keys" || return 1
  fi
}

if [ "${RECAST_SSH_ONCE:-0}" = 1 ]; then
  recast_fix_ssh_permissions
  exit $?
fi

recast_fix_ssh_permissions || echo 'RECAST_SSH_WARNING Waiting to repair SSH file permissions'
(
  trap '' HUP
  while :; do
    recast_fix_ssh_permissions || :
    sleep 3
  done
) </dev/null >/dev/null 2>&1 &
echo 'RECAST_SSH_PERMISSIONS Ownership and permission maintenance enabled'

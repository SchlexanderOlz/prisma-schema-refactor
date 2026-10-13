#!/usr/bin/env bash
# Symlink every skill folder (a directory with SKILL.md) into ~/.claude/skills/.
# Idempotent. Never overwrites anything that is not a symlink.
#   ./install.sh              install from ./skills
#   ./install.sh <skills-dir> install from another checkout (used by CI for the PR's skill)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
src="$(cd "${1:-$here/skills}" && pwd -P)"
dest="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
mkdir -p "$dest"
status=0
for dir in "$src"/*/; do
  [ -f "$dir/SKILL.md" ] || continue
  name="$(basename "$dir")"
  target="$(cd "$dir" && pwd -P)"
  link="$dest/$name"
  if [ -L "$link" ]; then
    if [ "$(readlink "$link")" = "$target" ]; then
      echo "ok         $name -> $target"
    else
      ln -sfn "$target" "$link"
      echo "updated    $name -> $target"
    fi
  elif [ -e "$link" ]; then
    echo "skipped    $name: $link exists and is not a symlink; remove it yourself if you want this one" >&2
    status=1
  else
    ln -s "$target" "$link"
    echo "installed  $name -> $target"
  fi
done
exit "$status"

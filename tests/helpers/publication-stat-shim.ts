import { join } from "node:path";

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Test-only owner projection; all filesystem metadata is read afresh. */
export function createPublicationStatShim(options: {
  releaseRoot: string;
  sharedRoot: string;
  faultRoot: string;
  statExecutable?: string;
}): string {
  const command = quoteShell(options.statExecutable ?? "/usr/bin/stat");
  return `#!/usr/bin/env bash
set -euo pipefail
path="\${!#}"
format="\${2:-}"
if metadata="$(${command} -c '%a:%h:%s' -- "$path" 2>/dev/null)"; then :; else
  # BSD Lp alone omits suid/sgid/sticky. Combine the special digit with
  # exactly three rwx digits to match GNU %a without including file-type bits.
  metadata="$(${command} -f '%OMp%03OLp:%l:%z' -- "$path")"
fi
[[ "$metadata" =~ ^[0-7]{1,4}:[0-9]+:[0-9]+$ ]] || exit 65
IFS=: read -r mode links size <<< "$metadata"
printf -v mode '%o' "$((8#$mode))"
owner='root:root'
if [[ "$path" == ${quoteShell(`${options.releaseRoot}/`)}* ||
  "$path" == ${quoteShell(options.sharedRoot)} ||
  "$path" == ${quoteShell(`${options.sharedRoot}/`)}* ]]; then
  owner='root:diesel'
fi
if [[ -f ${quoteShell(join(options.faultRoot, "bad-marker-owner"))} ]]; then
  owner='diesel:diesel'
fi
if [[ -f ${quoteShell(join(options.faultRoot, "bad-marker-mode"))} ]]; then
  mode='640'
fi
case "$format" in
  *'%U:%G:%a'*) printf '%s:%s\\n' "$owner" "$mode" ;;
  *'%s'*) printf '%s\\n' "$size" ;;
  *'%h'*) printf '%s\\n' "$links" ;;
  *'%a'*) printf '%s\\n' "$mode" ;;
  *) exit 64 ;;
esac
`;
}

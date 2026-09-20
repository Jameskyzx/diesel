"""Validate gitleaks 8.21.2 outcomes; exit code zero alone is not scan success."""

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path


class ScanFailure(Exception):
    pass


def run_scan(binary, config, source, report, ignore_directory, *, canary):
    command = [
        str(binary), "detect", "--source", str(source),
        "--config", str(config), "--redact=100", "--no-banner", "--no-color",
        "--log-level", "info", "--report-format", "json",
        "--report-path", str(report), "--exit-code", "97",
        "--gitleaks-ignore-path", str(ignore_directory),
    ]
    if canary:
        command.append("--no-git")
    else:
        command.append("--log-opts=--all --full-history --diff-merges=separate --root")

    label = "canary" if canary else "history"
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, encoding="utf-8",
            timeout=30 if canary else 450, check=False,
        )
    except subprocess.TimeoutExpired as cause:
        raise ScanFailure(label + " scan timed out") from cause
    except (OSError, UnicodeError) as cause:
        raise ScanFailure(label + " scanner could not execute or decode output") from cause

    expected_status = 97 if canary else 0
    if result.returncode != expected_status:
        raise ScanFailure(label + " scanner returned unexpected status %s" % result.returncode)

    # The pinned release can emit ERR, then "no leaks found", and still exit 0.
    # Never echo arbitrary diagnostics: even an error can contain secret input.
    diagnostics = result.stdout + "\n" + result.stderr
    if re.search(
        r"(?:^|\s)(?:ERR|FTL|PNC|ERROR|FATAL)(?:\s|$)|failed to scan|\berror=|\bpanic:",
        diagnostics, re.IGNORECASE | re.MULTILINE,
    ):
        raise ScanFailure(label + " scanner reported an error diagnostic")
    if len(re.findall(r"^.*\bINF scan completed in [^\r\n]+$", diagnostics, re.MULTILINE)) != 1:
        raise ScanFailure(label + " scan has no unique completion diagnostic")

    try:
        findings = json.loads(report.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as cause:
        raise ScanFailure(label + " report is missing or invalid JSON") from cause
    if not isinstance(findings, list):
        raise ScanFailure(label + " report must be a JSON array")

    if canary:
        if len(findings) != 1 or not isinstance(findings[0], dict):
            raise ScanFailure("canary report must contain exactly one finding")
        finding = findings[0]
        if (
            finding.get("RuleID") != "github-pat"
            or finding.get("File") not in ("canary.env", str(source / "canary.env"))
            or finding.get("Secret") != "REDACTED"
        ):
            raise ScanFailure("canary report does not identify the redacted synthetic token")
        return 1

    if findings:
        raise ScanFailure("history report contains %s secret finding(s)" % len(findings))
    if len(re.findall(r"^.*\bINF no leaks found$", diagnostics, re.MULTILINE)) != 1:
        raise ScanFailure("history scan has no unique no-leaks diagnostic")
    counts = re.findall(r"^.*\bINF ([0-9]+) commits scanned\.$", diagnostics, re.MULTILINE)
    if len(counts) != 1 or int(counts[0]) < 1:
        raise ScanFailure("history scan has no unique positive commit count")
    # This is the scanner's diagnostic count, NOT git rev-list cardinality:
    # commits without a scannable fragment (e.g. empty/deletion-only) may be omitted.
    return int(counts[0])


def main():
    if len(sys.argv) != 2:
        raise ScanFailure("usage: run-gitleaks.py <verified-gitleaks-binary>")
    binary = Path(sys.argv[1]).resolve()
    source = Path.cwd()
    config = source / ".gitleaks.toml"
    if not config.is_file():
        raise ScanFailure("repository .gitleaks.toml is missing")

    with tempfile.TemporaryDirectory(prefix="diesel-ci-gitleaks-") as temporary:
        directory = Path(temporary)
        canary = directory / "canary"
        canary.mkdir()
        (canary / "canary.env").write_text(
            "GITHUB_TOKEN=ghp_" + "0123456789abcdefgh" + "ijklmnopqrstuvwxyz\n",
            encoding="utf-8",
        )
        count = run_scan(binary, config, source, directory / "history.json", directory, canary=False)
        run_scan(binary, config, canary, directory / "canary.json", directory, canary=True)
        print("gitleaks accepted: %s scanner-counted commits, zero findings; synthetic canary detected" % count)


if __name__ == "__main__":
    try:
        main()
    except (ScanFailure, OSError) as cause:
        # OS errors can contain input paths; only ScanFailure messages are ours.
        message = str(cause) if isinstance(cause, ScanFailure) else "temporary scan files unavailable"
        print("gitleaks verification failed: " + message, file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Read-only, cross-platform worktree audit. Never decides deletion is authorized."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def run(args, cwd):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def audit(repo):
    raw = subprocess.check_output(['git', 'worktree', 'list', '--porcelain', '-z'], cwd=repo).decode()
    paths = [field[9:] for field in raw.split('\0') if field.startswith('worktree ')]
    if not paths:
        raise RuntimeError('No worktrees found')
    prs = run(['gh', 'pr', 'list', '--state', 'all', '--limit', '1000', '--json', 'number,state,headRefName'], repo)
    prs = json.loads(prs) if prs else []
    agent = Path(os.environ.get('PI_CODING_AGENT_DIR', str(Path.home() / '.pi/agent')))
    sessions = agent / 'sessions' / ('--' + str(Path(paths[0]).resolve()).strip('/').replace('/', '-') + '--')
    chats = list(sessions.glob('*.jsonl')) if sessions.exists() else []
    print('AGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE')
    for path in paths[1:]:
        branch = run(['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], path) or ''
        sha = run(['git', 'rev-parse', 'HEAD'], path)
        stamp = run(['git', 'log', '-1', '--format=%ct'], path)
        age = f'{int((time.time() - int(stamp)) / 86400)}d' if stamp else '?'
        dirty = run(['git', 'status', '--porcelain', '--untracked-files=all'], path)
        dirty = 'unknown' if dirty is None else 'clean' if not dirty else 'uncommitted'
        remote = run(['git', 'rev-parse', '--verify', f'refs/remotes/origin/{branch}'], path) if branch else None
        pushed = 'pushed' if remote and remote == sha else 'not-confirmed'
        pr = next((pr for pr in prs if pr['headRefName'] == branch), None)
        merged = subprocess.run(['git', 'merge-base', '--is-ancestor', 'HEAD', 'origin/main'], cwd=path, capture_output=True).returncode == 0
        merged = merged or bool(pr and pr['state'] == 'MERGED')
        last = max((f.stat().st_mtime for f in chats if path in f.read_text(errors='replace')), default=0)
        bucket = 'hold-uncommitted' if dirty != 'clean' else 'hold-unpushed' if pushed != 'pushed' and not merged else 'hold-open-pr' if pr and pr['state'] == 'OPEN' else 'verify-recent-chat' if last and time.time() - last < 4 * 86400 else 'review-merged' if merged else 'review'
        # ponytail: workspace transcripts only; ask the operator about pinned/external sessions before pruning.
        print('\t'.join([age, 'yes' if merged else 'no', dirty, pushed, f"#{pr['number']}/{pr['state']}" if pr else '-', datetime.datetime.fromtimestamp(last).isoformat() if last else '-', bucket, path]))


if __name__ == '__main__':
    audit(sys.argv[1] if len(sys.argv) > 1 else os.getcwd())

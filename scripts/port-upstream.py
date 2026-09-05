#!/usr/bin/env python3
"""Apply the mechanical Cursor-to-pi edits to a freshly copied upstream tree."""
from pathlib import Path
import re

for root in ('skills', 'agents', 'automations', 'docs'):
    for path in Path(root).rglob('*'):
        if path.suffix not in ('.md', '.yaml'):
            continue
        text = path.read_text()
        text = text.replace('~/.cursor/rules/pstack-models.mdc', '~/.pi/agent/pstack.json')
        text = text.replace('~/.cursor/skills/', '~/.pi/agent/skills/').replace('.cursor/', '.pi/')
        text = text.replace('pstack/skills/', 'skills/')
        text = text.replace('name: Poteto Mode', 'name: poteto-mode').replace('name: Make Bot UI', 'name: make-bot-ui')
        text = text.replace('name: Comment Sicko', 'name: comment-sicko')
        text = re.sub(r'^(mode|icon|color|reminder|paths|is_background):.*\n', '', text, flags=re.M)
        text = text.replace("Cursor's built-in `create-skill`", 'the bundled `create-skill`')
        text = text.replace("Cursor's built-in for authoring SKILL.md files", 'the bundled pi authoring workflow')
        text = text.replace("Cursor's `/loop` command (a built-in, not a pstack skill)", 'the native `/loop` command')
        text = text.replace("Cursor's `/loop` command", 'the native `/loop` command')
        text = text.replace('the `cursor-team-kit` plugin', 'the bundled team-kit port')
        text = text.replace('from `cursor-team-kit`', 'from the bundled team-kit port')
        text = text.replace('`cursor-team-kit` publishes', 'This package includes')
        text = text.replace('Cursor cloud agent', 'isolated pi worker').replace('cloud workers', 'isolated workers')
        text = text.replace('cloud-agent URL', 'worker session path')
        for slug in ('claude-fable-5-1-thinking-max', 'gpt-5.6-sol-max', 'grok-4.6-fast-xhigh', 'claude-opus-5-thinking-xhigh'):
            text = text.replace(slug, 'inherit-parent')
        text = text.replace('agent-transcripts/', 'workspace sessions directory (from `pstack_history`)/')
        path.write_text(text)

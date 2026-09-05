# Third-party notices

## pstack

Source: https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/pstack

Copyright (c) 2026 Lauren Tan. MIT license reproduced in [LICENSE](LICENSE).

Includes all 45 ordinary skills, 23 playbooks, two agents, documentation/artwork, automation pack and helper scripts. Port modifications replace Cursor-specific paths, model defaults and platform mechanics, introduce the native pi runtime, and replace the macOS worktree audit with a conservative portable audit. The engineering workflows remain derived from pstack.

## cursor-team-kit

Source: https://github.com/cursor/plugins/tree/93b00b89ef425a9c1bac0d0b317dfc49c930ac99/cursor-team-kit

Only `skills/deslop`, `skills/control-cli`, `skills/control-ui` and `skills/verify-this` are included. The latter is a transitive reference of `control-ui`. No unrelated team-kit skills are included. Paths and runtime instructions are adapted for pi.

MIT License

Copyright (c) 2026 Cursor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Native port and dependencies

Native port copyright (c) 2026 ngctro, distributed under the same MIT terms.

Runtime dependencies are installed from their registries rather than vendored. They retain their own license notices. The Model Context Protocol SDK is MIT licensed; pi's core packages are peers supplied by the host. The preserved upstream helper package uses Commander under MIT. See the corresponding installed packages and lockfiles for exact dependency versions.

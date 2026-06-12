// 보호 브랜치 게이트 훅 (PreToolUse: Bash|PowerShell)
// git commit/push/merge/rebase가 보호 브랜치를 대상으로 하면 사용자 확인(ask)을 요구한다.
// 보호 브랜치 목록: ~/.claude/protected-branches.json — 직접 수정 가능, 저장 즉시 반영.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function loadConfig() {
  const fallback = { protected: ['main', 'master'], actions: ['commit', 'push', 'merge', 'rebase'] };
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude', 'protected-branches.json'), 'utf8');
    const cfg = JSON.parse(raw);
    return {
      protected: Array.isArray(cfg.protected) ? cfg.protected : fallback.protected,
      actions: Array.isArray(cfg.actions) ? cfg.actions : fallback.actions
    };
  } catch (e) {
    return fallback;
  }
}

function isProtected(branch, patterns) {
  return patterns.some(function (p) {
    if (p.indexOf('*') === -1) return branch === p;
    const escaped = p.split('*').map(function (s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('.*');
    return new RegExp('^' + escaped + '$').test(branch);
  });
}

function currentBranch(cwd) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
    }).toString().trim();
  } catch (e) {
    return null; // git 저장소가 아니면 검사 대상 아님
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    process.exit(0);
  }
  const command = (input.tool_input && input.tool_input.command) || '';
  if (!command || command.indexOf('git') === -1) process.exit(0);

  const cfg = loadConfig();
  const actionMatch = command.match(new RegExp('\\bgit\\b[^|;&]*?\\b(' + cfg.actions.join('|') + ')\\b'));
  if (!actionMatch) process.exit(0);
  const action = actionMatch[1];

  // push는 명령에 명시된 대상 브랜치 우선 (예: git push origin main, git push origin feat:main)
  let target = null;
  if (action === 'push') {
    const pushMatch = command.match(/git\s+push\s+(?:-[-\w=]+\s+)*[\w.-]+\s+([\w./:-]+)/);
    if (pushMatch) target = pushMatch[1].split(':').pop();
  }
  if (!target) target = currentBranch(input.cwd || process.cwd());
  if (!target) process.exit(0);

  if (!isProtected(target, cfg.protected)) process.exit(0);

  const labels = { commit: '커밋', push: 'push', merge: '병합(merge)', rebase: '리베이스' };
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: "보호 브랜치 '" + target + "'에 대한 " + (labels[action] || action) +
        ' 작업입니다. 진행할까요? (목록 수정: ~/.claude/protected-branches.json)'
    }
  }));
  process.exit(0);
}

main();

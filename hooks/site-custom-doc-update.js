#!/usr/bin/env node
/**
 * site-custom-doc-update.js — PostToolUse hook (Bash)
 *
 * 커밋 메시지 형식: type(scope): [사이트명] 제목
 *
 * 스코프 우선순위:
 *  1. 커밋 메시지의 (scope) → 즉시 파일명으로 사용
 *  2. 없으면 Claude가 기존 문서 목록 분석 후 스코프 추론
 *  3. 추론 불가 → 사용자에게 스코프 명시 요청 출력
 *
 * 프롬프트 커스터마이징: site-custom-doc-prompt.md 수정
 */

const { execSync, execFileSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// type(scope): [사이트명] 제목
const MSG_RE = /^(\w+)(?:\(([^)]+)\))?:\s*(?:\[([^\]]+)\]\s*)?(.+)$/;
const PROMPT_TEMPLATE = path.join(__dirname, 'site-custom-doc-prompt.md');

let input = '';
process.stdin.on('data', d => (input += d));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const cmd  = (data.tool_input?.command || '').trim();

    const isCommit = /\bgit\s+commit\b/.test(cmd);
    const isMerge  = /\bgit\s+merge\b/.test(cmd);
    if (!isCommit && !isMerge) return exit();

    // 인라인 환경변수 추출 (GIT_DIR=... git commit/merge ...)
    const inlineEnvMatch = cmd.match(/^((?:[A-Z_][A-Z0-9_]*=\S+\s+)*)git\s+(commit|merge)/);
    if (inlineEnvMatch?.[1]) {
      for (const pair of inlineEnvMatch[1].trim().split(/\s+/)) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) GIT_ENV[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      }
    }

    const branch = run('git rev-parse --abbrev-ref HEAD');
    if (!branch.startsWith('site/')) return exit();

    const commitMsg  = run('git log -1 --pretty=format:%s');
    let   commitBody = run('git log -1 --pretty=format:%b').trim();
    const hash       = run('git rev-parse --short HEAD');
    const author     = run('git log -1 --pretty=format:%an');
    const dateStr    = run('git log -1 --pretty=format:%ad --date=format:%Y-%m-%d');

    // ── 커밋 메시지 파싱 ──────────────────────────────────────────
    const msgMatch = commitMsg.match(MSG_RE);
    let commitType   = 'chore';
    let userScope    = null;
    let siteName     = null;
    let featureTitle = commitMsg;

    if (msgMatch) {
      [, commitType, userScope, siteName, featureTitle] = msgMatch;
      userScope    = userScope?.trim()    || null;
      siteName     = siteName?.trim()     || null;
      featureTitle = featureTitle.trim();
    }

    // ── 사이트명 확정 ─────────────────────────────────────────────
    if (!siteName) {
      siteName = findSiteNameFromOverview(branch);
    }

    if (!siteName) {
      process.stdout.write(
        `[site-custom-doc] site/* 브랜치(${branch})에서 커밋이 발생했으나 사이트명을 확인할 수 없습니다.\n` +
        `커밋 메시지: "${commitMsg}"\n\n` +
        `docs/site-custom/ 하위에 이 브랜치에 대한 OVERVIEW.md가 없습니다.\n` +
        `다음 중 하나를 알려주세요:\n` +
        `  1. 사이트명 (예: 농심, 국가철도공단) → OVERVIEW.md를 생성해드립니다.\n` +
        `  2. 다음 커밋부터 메시지 형식: feat: [사이트명] 기능제목\n`
      );
      return exit();
    }

    // ── 변경 파일 수집 ────────────────────────────────────────────
    let changedFiles, diffs;
    if (isMerge) {
      let origHead;
      try { origHead = run('git rev-parse ORIG_HEAD'); } catch (_) { return exit(); }

      changedFiles = sortByExtPriority(
        runFile(['diff', origHead, 'HEAD', '--name-only'])
          .split('\n').map(f => f.trim())
          .filter(f => f && /\.(java|js|ts|jsx|tsx|vue|xml|yml|yaml|sql)$/.test(f))
      );

      diffs = changedFiles.map(f => {
        try {
          // 셸 미경유(execFileSync)로 파일경로가 명령으로 해석되지 않게 한다
          const diff = execFileSync('git', ['diff', origHead, 'HEAD', '--', f], {
            encoding: 'utf8', maxBuffer: 1024 * 1024 * 5,
            stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ...GIT_ENV }
          });
          return { file: f, diff };
        } catch (_) { return { file: f, diff: '' }; }
      });

      const mergedMsgs = runFile(['log', `${origHead}..HEAD`, '--pretty=format:%s'])
        .split('\n').filter(Boolean);
      if (mergedMsgs.length) {
        commitBody = `병합된 커밋:\n${mergedMsgs.map(m => `- ${m}`).join('\n')}`;
      }
    } else {
      changedFiles = sortByExtPriority(
        run('git show HEAD --name-only --format=')
          .split('\n').map(f => f.trim())
          .filter(f => f && /\.(java|js|ts|jsx|tsx|vue|xml|yml|yaml|sql)$/.test(f))
      );
      diffs = collectDiffs(changedFiles);
    }

    if (changedFiles.length === 0) return exit();

    const docDir = path.join(process.cwd(), 'docs', 'site-custom', siteName);
    fs.mkdirSync(docDir, { recursive: true });

    const existingDocs = fs.existsSync(docDir)
      ? fs.readdirSync(docDir).filter(f => f.endsWith('.md') && f !== 'OVERVIEW.md')
      : [];

    // ── Claude 분석 ───────────────────────────────────────────────
    const analysis = analyzeWithClaudeCode({
      siteName, featureTitle, commitType, commitMsg, commitBody,
      changedFiles, diffs, existingDocs, userScope
    });

    // ── 스코프 확정 & 문서 파일 결정 ─────────────────────────────
    const effectiveScope = userScope || analysis.scope || null;

    if (analysis.needsClarification && !effectiveScope) {
      process.stdout.write(
        `[site-custom-doc] 스코프를 특정할 수 없습니다.\n` +
        `커밋: "${commitMsg}"\n` +
        `다음 커밋부터 스코프를 명시해주세요: feat(스코프): [${siteName}] 제목\n` +
        `예) feat(임시겸직): [${siteName}] 임시겸직 처리 추가\n`
      );
      return exit();
    }

    const docFile = resolveDocFile(docDir, effectiveScope, analysis, analysis.docTitle || featureTitle);

    if (!fs.existsSync(docFile)) {
      fs.writeFileSync(
        docFile,
        buildFeatureDoc({ siteName, featureTitle: analysis.docTitle || featureTitle, commitType, dateStr, hash, author, analysis }),
        'utf8'
      );
      log(`신규 문서 생성: docs/site-custom/${siteName}/${path.basename(docFile)}`);
    } else {
      appendHistory(docFile, { commitType, dateStr, hash, author, analysis });
      log(`문서 갱신: docs/site-custom/${siteName}/${path.basename(docFile)}`);
    }

    updateOverview(docDir, siteName, branch);

    autoCommitDocs(docFile, path.join(docDir, 'OVERVIEW.md'), siteName, effectiveScope);

  } catch (e) {
    err(e.message);
  }
  exit();
});

// ─── 문서 파일 경로 결정 ─────────────────────────────────────────────────────
function resolveDocFile(docDir, scope, analysis, resolvedTitle) {
  if (scope) {
    const safeScope = scope.replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, '-');
    return path.join(docDir, `${safeScope}.md`);
  }
  if (analysis.targetFile) {
    return path.join(docDir, analysis.targetFile);
  }
  const safeTitle = resolvedTitle.replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, '-');
  return path.join(docDir, `${safeTitle}.md`);
}

// ─── OVERVIEW.md에서 브랜치로 사이트명 검색 ─────────────────────────────────
function findSiteNameFromOverview(branch) {
  const baseDir = path.join(process.cwd(), 'docs', 'site-custom');
  if (!fs.existsSync(baseDir)) return null;

  for (const sitDir of fs.readdirSync(baseDir)) {
    const overviewPath = path.join(baseDir, sitDir, 'OVERVIEW.md');
    if (!fs.existsSync(overviewPath)) continue;

    const content = fs.readFileSync(overviewPath, 'utf8');
    const branchMatch = content.match(/\*\*브랜치:\*\*\s*`([^`]+)`/);
    if (branchMatch && branchMatch[1].trim() === branch) {
      const siteMatch = content.match(/\*\*사이트명:\*\*\s*(.+)/);
      return siteMatch ? siteMatch[1].trim() : sitDir;
    }
  }
  return null;
}

// ─── OVERVIEW.md 생성/갱신 ────────────────────────────────────────────────────
function updateOverview(docDir, siteName, branch) {
  const overviewFile = path.join(docDir, 'OVERVIEW.md');
  const today        = new Date().toISOString().split('T')[0];

  const featureDocs = fs.readdirSync(docDir)
    .filter(f => f.endsWith('.md') && f !== 'OVERVIEW.md')
    .sort();

  const rows = featureDocs.map(f => {
    const content    = fs.readFileSync(path.join(docDir, f), 'utf8');
    const titleMatch = content.match(/^# \[[^\]]+\] (.+)$/m);
    const typeMatch  = content.match(/\*\*유형:\*\*\s*(\w+)/);
    const firstDate  = content.match(/\*\*최초 작성:\*\*\s*(.+)/)?.[1]?.trim() || '—';
    const histDates  = [...content.matchAll(/^### (\d{4}-\d{2}-\d{2})/gm)].map(m => m[1]);
    const lastDate   = histDates[0] || firstDate;
    const title = titleMatch?.[1] || f.replace('.md', '').replace(/-/g, ' ');
    const type  = typeMatch?.[1] || '—';
    return `| ${title} | ${type} | ${firstDate} | ${lastDate} | [문서](./${f}) |`;
  });

  const content = `# [${siteName}] 사이트 커스텀 개요

- **사이트명:** ${siteName}
- **브랜치:** \`${branch}\`
- **마지막 갱신:** ${today}

---

## 커스텀 기능 목록

| 기능명 | 유형 | 최초 작성 | 마지막 수정 | 상세 문서 |
|--------|------|-----------|-------------|-----------|
${rows.length ? rows.join('\n') : '| (없음) | — | — | — | — |'}
`;

  fs.writeFileSync(overviewFile, content, 'utf8');
  log(`OVERVIEW.md 갱신: docs/site-custom/${siteName}/OVERVIEW.md`);
}

// ─── Claude Code CLI 분석 ─────────────────────────────────────────────────────
function analyzeWithClaudeCode({ siteName, featureTitle, commitType, commitMsg, commitBody, changedFiles, diffs, existingDocs, userScope }) {
  const diffText = diffs
    .map(d => `### ${d.file}\n\`\`\`diff\n${d.diff.slice(0, 3000)}\n\`\`\``)
    .join('\n\n');

  const existingDocList = existingDocs.length
    ? existingDocs.map(f => `- ${f}`).join('\n')
    : '(없음)';

  const scopeInstruction = userScope
    ? `사용자가 스코프를 "${userScope}"으로 명시했습니다. scope 필드를 "${userScope}"으로 설정하고 needsClarification은 false로 설정하세요.`
    : `스코프가 명시되지 않았습니다. 변경 파일과 기존 문서 목록을 분석해 가장 적합한 스코프(기능 도메인명)를 추론하세요.\n추론이 가능하면 scope에 한글 스코프명을 설정하세요 (예: "임시겸직", "결재선", "공지사항").\n추론이 불가능하면 needsClarification: true로 설정하세요.`;

  let prompt;
  try {
    prompt = fs.readFileSync(PROMPT_TEMPLATE, 'utf8')
      .replace(/\{\{siteName\}\}/g,         siteName)
      .replace(/\{\{commitMsg\}\}/g,        commitMsg)
      .replace(/\{\{commitBody\}\}/g,       commitBody || '없음')
      .replace(/\{\{changedFiles\}\}/g,     changedFiles.join(', '))
      .replace(/\{\{existingDocList\}\}/g,  existingDocList)
      .replace(/\{\{scopeInstruction\}\}/g, scopeInstruction)
      .replace(/\{\{diffText\}\}/g,         diffText);
  } catch (_) {
    prompt = `"${siteName}" 사이트 커스텀 커밋을 분석해 JSON만 반환하세요.\n커밋: ${commitMsg}\n변경파일: ${changedFiles.join(', ')}\n\n${diffText}`;
  }

  try {
    const result = spawnSync('claude', ['-p', prompt, '--output-format', 'text'], {
      encoding: 'utf8',
      timeout: 90000,
      maxBuffer: 1024 * 1024 * 5
    });

    if (result.error || result.status !== 0) {
      err(`claude -p 오류: ${result.stderr || result.error?.message}`);
      return buildFallbackAnalysis(featureTitle, changedFiles, userScope);
    }

    const text      = (result.stdout || '').trim();
    const jsonMatch = text.match(/\{[\s\S]+\}/);
    if (!jsonMatch) {
      err('claude 응답에서 JSON을 찾을 수 없음');
      return buildFallbackAnalysis(featureTitle, changedFiles, userScope);
    }

    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    err(`분석 실패: ${e.message}`);
    return buildFallbackAnalysis(featureTitle, changedFiles, userScope);
  }
}

function buildFallbackAnalysis(featureTitle, changedFiles, userScope) {
  return {
    scope: userScope || null,
    needsClarification: false,  // AI 실패 시에도 문서 생성, 수동 작성 필요 표시
    targetFile: null,
    docTitle: featureTitle,
    customerRequirement: `${featureTitle} 관련 커스터마이징 (수동 작성 필요)`,
    summary: `${featureTitle} 기능 커스텀`,
    classes: changedFiles.map(f => ({
      className: path.basename(f, path.extname(f)),
      filePath: f,
      extendsOrImplements: '',
      customScope: '(수동 작성 필요)',
      description: '(수동 작성 필요)',
      changePoints: []
    }))
  };
}

// ─── 문서 빌더 ────────────────────────────────────────────────────────────────
function buildFeatureDoc({ siteName, featureTitle, commitType, dateStr, hash, author, analysis }) {
  const classDocs = (analysis.classes || []).map(buildClassSection).join('\n\n---\n\n');

  return `# [${siteName}] ${featureTitle}

- **사이트:** ${siteName}
- **유형:** ${commitType}
- **최초 작성:** ${dateStr}

---

## 고객 요구사항

${analysis.customerRequirement}

---

## 기능 요약

${analysis.summary}

---

## 커스텀 클래스 분석

${classDocs}

---

## 변경 이력

### ${dateStr} — ${commitType.toUpperCase()} \`${hash}\` (${author})

> 최초 개발

${(analysis.classes || []).map(c => `- \`${c.className}\`: ${c.customScope}`).join('\n')}
`;
}

function buildClassSection(c) {
  const hasInheritance = c.extendsOrImplements && c.extendsOrImplements.trim();

  const infoRows = [
    `| **파일** | \`${c.filePath}\` |`,
    hasInheritance ? `| **상속/구현** | ${c.extendsOrImplements} |` : null,
    `| **커스텀 범위** | ${c.customScope} |`,
  ].filter(Boolean).join('\n');

  const changeSection = hasInheritance && (c.changePoints || []).length > 0
    ? `\n\n#### 표준 대비 변경점\n\n| 처리 항목 | 표준 방식 | 커스텀 방식 |\n|-----------|-----------|------------|\n` +
      c.changePoints.map(p => `| ${p.item} | ${p.standard} | ${p.custom} |`).join('\n')
    : '';

  return `### ${c.className}

| 항목 | 내용 |
|------|------|
${infoRows}

#### 기능 설명

${c.description}${changeSection}`;
}

function appendHistory(docFile, { commitType, dateStr, hash, author, analysis }) {
  let content = fs.readFileSync(docFile, 'utf8');

  const newEntry = `### ${dateStr} — ${commitType.toUpperCase()} \`${hash}\` (${author})\n\n` +
    (analysis.classes || []).map(c =>
      `**\`${c.className}\`**\n- 범위: ${c.customScope}\n- 내용: ${c.description}`
    ).join('\n\n');

  const marker = '## 변경 이력\n';
  if (content.includes(marker)) {
    const markerIdx = content.indexOf(marker);
    const before    = content.slice(0, markerIdx + marker.length);
    const after     = content.slice(markerIdx + marker.length);

    // 기존 이력 항목 + 신규 항목을 날짜 내림차순으로 정렬
    const entries = [newEntry, ...after.split(/(?=### \d{4}-\d{2}-\d{2})/)]
      .map(e => e.trim()).filter(Boolean);

    entries.sort((a, b) => {
      const da = a.match(/^### (\d{4}-\d{2}-\d{2})/)?.[1] || '';
      const db = b.match(/^### (\d{4}-\d{2}-\d{2})/)?.[1] || '';
      return db.localeCompare(da);  // 최신이 위
    });

    content = before + entries.join('\n\n') + '\n';
  } else {
    content += `\n---\n\n## 변경 이력\n\n${newEntry}\n`;
  }

  fs.writeFileSync(docFile, content, 'utf8');
}

// ─── Git 환경 (WSL worktree 경로 보정) ───────────────────────────────────────
function resolveGitEnv() {
  try {
    const gitPath = path.join(process.cwd(), '.git');
    if (!fs.statSync(gitPath).isFile()) return {};

    const content = fs.readFileSync(gitPath, 'utf8').trim();
    const match   = content.match(/^gitdir:\s*(.+)$/);
    if (!match) return {};

    let gitDir  = match[1].trim();
    const isWsl = fs.existsSync('/proc/version') &&
                  fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');

    if (/^[A-Za-z]:[\\/]/.test(gitDir) && isWsl) {
      gitDir = gitDir
        .replace(/^([A-Za-z]):[\\/]/, (_, d) => `/mnt/${d.toLowerCase()}/`)
        .replace(/\\/g, '/');
    }

    return { GIT_DIR: gitDir };
  } catch (_) {}
  return {};
}

let GIT_ENV = resolveGitEnv();

function run(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, ...GIT_ENV }
  }).trim();
}

// 셸 미경유 git 실행 — 인자배열로 전달해 변수가 명령으로 해석되지 않게 한다
function runFile(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, ...GIT_ENV }
  }).trim();
}

// ─── 문서 자동 커밋 (경로 한정) ──────────────────────────────────────────────
// 생성·갱신된 문서 두 개만 경로 한정으로 add 후 직접 커밋한다.
// - 셸 미경유(execFileSync)라 siteName/effectiveScope/경로의 $(...)·백틱·;·개행이 명령으로 해석되지 않는다.
// - `git add -- <경로>`로 두 문서만 스테이징하고 `git commit -- <경로>`로 파일 지정 커밋하므로
//   사용자가 다른 곳에 해둔 스테이징 상태를 훼손하지 않는다. (add 없이 commit만 하면 신규
//   untracked 문서를 pathspec이 잡지 못해 커밋 전체가 실패하므로 add 단계가 필수다.)
// - 이 커밋은 Node 자식 프로세스로 실행되어 Bash/PowerShell 도구 이벤트를 만들지 않으므로
//   PostToolUse 훅(매처: Bash|PowerShell)을 재발동시키지 않는다.
function autoCommitDocs(docFile, overviewFile, siteName, effectiveScope) {
  const msgScope     = effectiveScope ? `(${effectiveScope})` : '';
  const docCommitMsg = `docs${msgScope}: [${siteName}] 커스텀 문서 자동 갱신`;
  // 존재하는 문서만 대상으로 한다(방어적). 신규(untracked) 문서는 commit 직전 add가 없으면
  // `git commit -- <pathspec>`가 잡지 못해 커밋 전체가 실패하므로 경로 한정 add를 먼저 한다.
  const targets = [docFile, overviewFile].filter(f => f && fs.existsSync(f));
  if (!targets.length) {
    log('문서 자동 커밋 생략: 커밋 대상 문서 없음');
    return;
  }
  try {
    // stderr를 파이프로 받아 실패 사유를 구분 로깅할 수 있게 한다
    // 경로 한정 add — 사용자가 다른 곳에 해둔 스테이징은 건드리지 않는다(M-2 의도 유지)
    execFileSync('git', ['add', '--', ...targets], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...GIT_ENV }
    });
    execFileSync('git', ['commit', '-m', docCommitMsg, '--', ...targets], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...GIT_ENV }
    });
    log(`문서 자동 커밋: ${docCommitMsg}`);
  } catch (e) {
    // 변경 없음(nothing to commit)·detached HEAD 등 정상적으로 커밋 안 되는 경우와 진짜 오류를 구분해 로깅
    const detail = `${e.stdout || ''}\n${e.stderr || ''}`.trim() || (e.message || '');
    if (/nothing to commit|no changes added|변경 사항 없음/.test(detail)) {
      log('문서 자동 커밋 생략: 커밋할 문서 변경 없음');
    } else if (/HEAD detached|detached HEAD|분리된 HEAD/.test(detail)) {
      log('문서 자동 커밋 생략: detached HEAD 상태');
    } else {
      err(`문서 자동 커밋 실패: ${detail}`);
    }
  }
}

// java/js/ts 우선 → xml/yml은 후순위 (diff 잘릴 경우 핵심 파일 보존)
const EXT_PRIORITY = ['.java', '.js', '.ts', '.tsx', '.jsx', '.vue', '.sql', '.xml', '.yml', '.yaml'];
function sortByExtPriority(files) {
  return [...files].sort((a, b) => {
    const ai = EXT_PRIORITY.indexOf(path.extname(a));
    const bi = EXT_PRIORITY.indexOf(path.extname(b));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

function collectDiffs(files) {
  return files.map(f => {
    try {
      // 셸 미경유(execFileSync)로 파일경로가 명령으로 해석되지 않게 한다
      const diff = execFileSync('git', ['show', 'HEAD', '--', f], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 5,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...GIT_ENV }
      });
      return { file: f, diff };
    } catch (_) {
      return { file: f, diff: '' };
    }
  });
}

function log(msg) { process.stdout.write(`[site-custom-doc] ${msg}\n`); }
function err(msg) { process.stderr.write(`[site-custom-doc] ERROR: ${msg}\n`); }
function exit()   { process.exit(0); }

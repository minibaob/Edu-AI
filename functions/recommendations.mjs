// 首页个性化推荐：纯规则匹配，不调用任何 AI。
// 内容只来自 resources / admission_scores 表的真实行；资料缺失或表不可读时
// 如实返回空，不编造推荐。归属与资料只来自已验证会话。
import { json, rows } from './http.mjs';
import { validateSession } from './sessions.mjs';

const RESOURCE_COLUMNS = 'id,title,grade,subject,created_at';
const SCORE_COLUMNS = 'university_code,school_name,province,year';

async function loadProfile(db, request) {
  try {
    const result = await validateSession(db, request);
    if (result.state !== 'valid' || !result.session) return null;
    const found = rows(await db.from('users').select('grade,province,subjects')
      .eq('id', result.session.userId).limit(1));
    if (found.length !== 1) return null;
    const row = found[0];
    return {
      grade: row.grade ?? null,
      province: row.province ?? null,
      subjects: row.subjects ? JSON.parse(row.subjects) : [],
    };
  } catch {
    return null;
  }
}

export async function listRecommendations(db, request) {
  const profile = await loadProfile(db, request);
  const items = [];

  try {
    const all = rows(await db.from('resources').select(RESOURCE_COLUMNS).limit(500));
    const scored = all.map((row) => {
      const gradeMatch = profile?.grade != null && row.grade === profile.grade;
      const subjectMatch = row.subject != null && Array.isArray(profile?.subjects)
        && profile.subjects.includes(row.subject);
      return { row, gradeMatch, subjectMatch, score: (gradeMatch ? 1 : 0) + (subjectMatch ? 2 : 0) };
    });
    scored.sort((a, b) => b.score - a.score
      || String(b.row.created_at).localeCompare(String(a.row.created_at)));
    for (const { row, gradeMatch, subjectMatch } of scored.slice(0, 2)) {
      const reason = gradeMatch && subjectMatch
        ? `匹配你的年级「${profile.grade}」与选科「${row.subject}」`
        : subjectMatch
          ? `匹配你的选科「${row.subject}」`
          : gradeMatch
            ? `匹配你的年级「${profile.grade}」`
            : '资料库最新收录';
      items.push({
        kind: 'resource',
        id: row.id,
        title: row.title,
        badges: [row.subject, row.grade].filter(Boolean),
        reason,
        link: `/resources?id=${row.id}`,
      });
    }
  } catch {
    // 资料表不可读时不出资料推荐，前端如实显示空态。
  }

  // 官方数据未含院校所在省份，不编造；改用「在用户省份有真实录取数据」的院校。
  if (profile?.province) {
    try {
      const found = rows(await db.from('admission_scores').select(SCORE_COLUMNS)
        .eq('province', profile.province).order('university_code', { ascending: true }).limit(1));
      if (found.length === 1 && found[0].school_name) {
        const score = found[0];
        items.push({
          kind: 'university',
          id: score.university_code,
          title: score.school_name,
          badges: [score.province, `${score.year} 年录取`].filter(Boolean),
          reason: `在你设置的省份「${profile.province}」有历年录取数据`,
          link: `/universities/${score.university_code}`,
        });
      }
    } catch {
      // 录取表不可读或该省无数据时不出高校推荐。
    }
  }

  const personalized = profile != null
    && (profile.grade != null || profile.province != null || profile.subjects.length > 0);
  return json({ personalized, items });
}
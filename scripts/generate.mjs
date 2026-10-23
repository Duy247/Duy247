import { mkdir, writeFile } from 'node:fs/promises';

const USER = 'Duy247';
const TOKEN = process.env.GITHUB_TOKEN;
const now = new Date();
const today = now.toISOString().slice(0, 10);
const year = now.getUTCFullYear();
const output = new URL('../assets/generated/', import.meta.url);
const headers = { 'User-Agent': 'duyvanthanh-live-cards', Accept: 'application/vnd.github+json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
async function graphql(query, variables = {}) {
  const result = await request('https://api.github.com/graphql', {
    method: 'POST', headers, body: JSON.stringify({ query, variables }),
  });
  if (result.errors?.length) throw new Error(result.errors.map(e => e.message).join('; '));
  if (!result.data?.user) throw new Error(`GitHub user ${USER} was not found`);
  return result.data.user;
}
async function calendar(from, to) {
  return (await graphql(`query($from:DateTime!,$to:DateTime!){user(login:"${USER}"){
    contributionsCollection(from:$from,to:$to){contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}
  }}`, { from, to })).contributionsCollection.contributionCalendar;
}
async function contributions() {
  let cal = await calendar(`${year}-01-01T00:00:00Z`, now.toISOString());
  const total = cal.totalContributions;
  let streak = 0;
  let skipToday = true;
  // Continue across January 1 if the active streak reaches the year's boundary.
  for (let y = year; ; y--) {
    const days = cal.weeks.flatMap(w => w.contributionDays).filter(d => d.date <= today).sort((a, b) => b.date.localeCompare(a.date));
    for (const day of days) {
      if (skipToday && day.date === today && day.contributionCount === 0) { skipToday = false; continue; }
      skipToday = false;
      if (day.contributionCount === 0) return { total, streak };
      streak++;
    }
    if (!days.length) return { total, streak };
    cal = await calendar(`${y - 1}-01-01T00:00:00Z`, `${y - 1}-12-31T23:59:59Z`);
  }
}
async function authenticatedRepos() {
  const repos = [];
  let cursor = null;
  do {
    const user = await graphql(`query($cursor:String){user(login:"${USER}"){
      repositories(first:100,after:$cursor,ownerAffiliations:OWNER,privacy:PUBLIC){
        nodes{name isFork stargazerCount languages(first:100){edges{size node{name}} pageInfo{hasNextPage endCursor}}}
        pageInfo{hasNextPage endCursor}
      }
    }}`, { cursor });
    repos.push(...user.repositories.nodes);
    cursor = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
  } while (cursor);
  const languages = new Map();
  for (const repo of repos.filter(r => !r.isFork)) {
    let page = repo.languages;
    while (true) {
      for (const { size, node } of page.edges) languages.set(node.name, (languages.get(node.name) ?? 0) + size);
      if (!page.pageInfo.hasNextPage) break;
      page = (await graphql(`query($name:String!,$cursor:String!){user(login:"${USER}"){repository(name:$name){languages(first:100,after:$cursor){edges{size node{name}} pageInfo{hasNextPage endCursor}}}}}`, { name: repo.name, cursor: page.pageInfo.endCursor })).repository.languages;
    }
  }
  return { repos: repos.length, stars: repos.reduce((n, r) => n + r.stargazerCount, 0), languages };
}
async function restRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await request(`https://api.github.com/users/${USER}/repos?type=owner&per_page=100&page=${page}`, { headers });
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const languages = new Map();
  for (const repo of repos.filter(r => !r.fork)) {
    const bytes = await request(repo.languages_url, { headers });
    for (const [name, size] of Object.entries(bytes)) languages.set(name, (languages.get(name) ?? 0) + size);
  }
  return { repos: repos.length, stars: repos.reduce((n, r) => n + r.stargazers_count, 0), languages };
}
const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const num = n => n.toLocaleString('en-US');
const themes = {
  dark: { bg: '#1C1E22', border: '#373B42', text: '#F6F7F9', muted: '#A7ADB7', accent: '#F5A524', green: '#3DDC97', track: '#30343B' },
  light: { bg: '#F6F7F9', border: '#D5D9DF', text: '#1C1E22', muted: '#59616D', accent: '#F5A524', green: '#3DDC97', track: '#E0E4E9' },
};
function card(theme, title, subtitle, body, footer) {
  const t = themes[theme];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="405" height="260" viewBox="0 0 405 260" role="img" aria-labelledby="title desc">
<title id="title">${xml(`duyvanthanh | ${title}`)}</title><desc id="desc">${xml(`${subtitle}. ${footer}`)}</desc>
<style>text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;fill:${t.text};font-size:12px}.muted{fill:${t.muted}}.accent{fill:${t.accent}}.content{animation:appear .65s ease-out both}@keyframes appear{from{opacity:.45}to{opacity:1}}@media(prefers-reduced-motion:reduce){.content{animation:none}}</style>
<rect x=".5" y=".5" width="404" height="259" rx="12" fill="${t.bg}" stroke="${t.border}"/>
<path d="M1 44H404" stroke="${t.border}"/>
<circle cx="20" cy="22" r="4" fill="${t.green}"/><circle cx="34" cy="22" r="4" fill="${t.accent}"/><circle cx="48" cy="22" r="4" fill="${t.muted}" opacity=".25"/>
<text x="66" y="26" class="muted">duyvanthanh / ${xml(title)}</text>
<g class="content"><text x="20" y="70" class="accent">|&gt;</text><text x="44" y="70">${xml(subtitle)}</text>
${body(t)}
</g><path d="M20 224H385" stroke="${t.border}"/><text x="20" y="245" class="muted" style="font-size:10px">${xml(footer)}</text></svg>
`;
}
async function main() {
  console.log(TOKEN ? 'Fetching authenticated GitHub GraphQL data.' : 'No GITHUB_TOKEN: using public REST; contributions and streak are placeholder zeros.');
  let offline = false;
  const sampleOnFailure = fallback => error => {
    if (TOKEN) throw error;
    offline = true;
    console.warn(`Offline sample fallback: ${error.message}`);
    return fallback;
  };
  const [github, activity, downloads] = await Promise.all([
    TOKEN ? authenticatedRepos() : restRepos().catch(sampleOnFailure({ repos: 0, stars: 0, languages: new Map() })),
    TOKEN ? contributions() : { total: 0, streak: 0 },
    Promise.all(['@duy247/uk6', '@duy247/git-training'].map(async name => {
      try {
        const data = await request(`https://api.npmjs.org/downloads/point/last-week/${name}`);
        if (data.error || !Number.isFinite(data.downloads) || data.downloads < 0) {
          throw new Error(data.error || 'Invalid npm downloads response');
        }
        return { name, ...data };
      } catch (error) {
        console.warn(`npm downloads unavailable for ${name}; using 0 downloads: ${error.message}`);
        return { name, downloads: 0, start: 'unavailable', end: 'unavailable' };
      }
    })),
  ]);
  const sampleFooter = `SAMPLE / offline data unavailable / ${today}`;
  const languages = [...github.languages].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  const allBytes = [...github.languages.values()].reduce((a, b) => a + b, 0);
  const colors = ['#F5A524', '#3DDC97', '#F5A524', '#3DDC97', '#F5A524'];
  await mkdir(output, { recursive: true });
  for (const theme of Object.keys(themes)) {
    const stats = card(theme, 'stats', `report github --year ${year}`, () => {
      const rows = [['contributions', num(activity.total)], ['current streak', `${num(activity.streak)} days`], ['public repos', num(github.repos)], ['stars received', num(github.stars)]];
      return rows.map(([label, value], i) => `<text x="24" y="${101 + i * 32}" class="muted">${label}</text><text x="381" y="${101 + i * 32}" text-anchor="end">${xml(value)}</text>`).join('\n');
    }, offline ? sampleFooter : TOKEN ? `PASS / public GitHub data / ${today} UTC` : `SAMPLE / activity = 0 (no token) / ${today}`);
    const langs = card(theme, 'languages', 'report languages --top 5', t => languages.length ? languages.map(([name, bytes], i) => {
      const y = 94 + i * 25;
      const pct = allBytes ? bytes / allBytes * 100 : 0;
      return `<circle cx="24" cy="${y - 4}" r="3" fill="${colors[i]}"/><text x="35" y="${y}">${xml(name.length > 22 ? name.slice(0, 21) + '…' : name)}</text><text x="381" y="${y}" text-anchor="end" class="muted">${pct.toFixed(1)}%</text><rect x="35" y="${y + 5}" width="346" height="3" rx="1.5" fill="${t.track}"/><rect x="35" y="${y + 5}" width="${(346 * pct / 100).toFixed(2)}" height="3" rx="1.5" fill="${colors[i]}"/>`;
    }).join('\n') : '<text x="24" y="120" class="muted">No language bytes reported.</text>', offline ? sampleFooter : `BYTES / owned public non-forks / ${today}`);
    const npm = card(theme, 'npm', 'report npm --last-week', t => downloads.map((pkg, i) => {
      const y = 102 + i * 65;
      const max = Math.max(1, ...downloads.map(p => p.downloads));
      return `<text x="24" y="${y}">${xml(pkg.name)}</text><text x="381" y="${y}" text-anchor="end" class="accent">${num(pkg.downloads)}</text><rect x="24" y="${y + 14}" width="357" height="6" rx="3" fill="${t.track}"/><rect x="24" y="${y + 14}" width="${(357 * pkg.downloads / max).toFixed(2)}" height="6" rx="3" fill="${t.accent}"/><text x="24" y="${y + 36}" class="muted" style="font-size:10px">downloads / ${xml(pkg.start)} to ${xml(pkg.end)}</text>`;
    }).join('\n'), offline ? sampleFooter : `PASS / npm weekly downloads / ${today} UTC`);
    for (const [name, svg] of Object.entries({ stats, langs, npm })) await writeFile(new URL(`${name}-${theme}.svg`, output), svg);
  }
  console.log(`Wrote six cards to ${output.pathname}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

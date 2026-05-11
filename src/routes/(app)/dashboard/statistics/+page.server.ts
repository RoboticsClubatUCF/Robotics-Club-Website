import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';

export type StatGroup = {
  label: string;
  key: string;
  items: { label: string; count: number }[];
};

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.member.permissions.level < 10) {
    throw redirect(302, '/dashboard');
  }

  const [members, surveys] = await Promise.all([
    db.member.findMany({
      select: {
        membershipExpDate: true,
        role: { select: { name: true, permissionLevel: true } }
      }
    }),
    db.survey.findMany({
      select: {
        ShirtSize: true,
        Year: true,
        Major: true,
        DiscoveredThrough: true,
        PrevMem: true,
        NumberofSemesters: true,
        Allergies: true
      }
    })
  ]);

  const now = new Date();

  // Helper: tally an array of strings
  function tally(values: string[]): { label: string; count: number }[] {
    const map: Record<string, number> = {};
    for (const v of values) {
      const key = v?.trim() || '(blank)';
      if (key) map[key] = (map[key] ?? 0) + 1;
    }
    return Object.entries(map)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }

  // ── Roles ──────────────────────────────────────────────────────────────
  const LEVEL_LABELS: Record<number, string> = {
    999: 'Admin', 10: 'Officer', 8: 'Lead',
    6: 'Committee', 4: 'Member', 0: 'Guest'
  };
  const roleMap: Record<string, number> = {};
  for (const m of members) {
    const label = LEVEL_LABELS[m.role.permissionLevel] ?? m.role.name;
    roleMap[label] = (roleMap[label] ?? 0) + 1;
  }
  const roles = Object.entries(roleMap)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  // ── Membership status ──────────────────────────────────────────────────
  let active = 0, expired = 0;
  for (const m of members) {
    if (m.membershipExpDate > now) active++; else expired++;
  }
  const membership = [
    { label: 'Active', count: active },
    { label: 'Expired', count: expired }
  ];

  // ── Shirt sizes ────────────────────────────────────────────────────────
  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
  const shirtRaw = tally(surveys.map((s) => s.ShirtSize).filter(Boolean));
  const shirts = [
    ...SIZE_ORDER
      .map((sz) => ({ label: sz, count: shirtRaw.find((r) => r.label === sz)?.count ?? 0 }))
      .filter((r) => r.count > 0),
    ...shirtRaw.filter((r) => !SIZE_ORDER.includes(r.label))
  ];

  // ── Academic year ──────────────────────────────────────────────────────
  const YEAR_ORDER = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'];
  const yearRaw = tally(surveys.map((s) => s.Year).filter(Boolean));
  const academicYear = [
    ...YEAR_ORDER
      .map((y) => ({ label: y, count: yearRaw.find((r) => r.label === y)?.count ?? 0 }))
      .filter((r) => r.count > 0),
    ...yearRaw.filter((r) => !YEAR_ORDER.includes(r.label))
  ];

  // ── Majors ─────────────────────────────────────────────────────────────
  const majors = tally(surveys.flatMap((s) => s.Major));

  // ── Discovered through ─────────────────────────────────────────────────
  const discoveredThrough = tally(surveys.flatMap((s) => s.DiscoveredThrough));

  // ── Previous member ────────────────────────────────────────────────────
  const prevMap: Record<string, number> = {};
  for (const s of surveys) {
    const v = s.PrevMem?.trim() || '(not specified)';
    prevMap[v] = (prevMap[v] ?? 0) + 1;
  }
  const previousMember = Object.entries(prevMap)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  // ── Semesters of membership ────────────────────────────────────────────
  const semesterMap: Record<number, number> = {};
  for (const s of surveys) {
    semesterMap[s.NumberofSemesters] = (semesterMap[s.NumberofSemesters] ?? 0) + 1;
  }
  const semesters = Object.entries(semesterMap)
    .map(([n, count]) => ({ label: `${n} semester${Number(n) === 1 ? '' : 's'}`, count }))
    .sort((a, b) => parseInt(a.label) - parseInt(b.label));

  // ── Allergies ──────────────────────────────────────────────────────────
  const allergies = tally(surveys.flatMap((s) => s.Allergies));

  const statGroups: StatGroup[] = [
    { label: 'Member Roles', key: 'roles', items: roles },
    { label: 'Membership Status', key: 'membership', items: membership },
    { label: 'Shirt Sizes', key: 'shirts', items: shirts },
    { label: 'Academic Year', key: 'academicYear', items: academicYear },
    { label: 'Majors', key: 'majors', items: majors },
    { label: 'How Members Discovered Club', key: 'discovered', items: discoveredThrough },
    { label: 'Previous Member Status', key: 'prevMember', items: previousMember },
    { label: 'Semesters of Membership', key: 'semesters', items: semesters },
    { label: 'Allergies / Dietary Needs', key: 'allergies', items: allergies }
  ];

  return { statGroups, totalMembers: members.length, totalSurveys: surveys.length };
};

<script lang="ts">
  import {
    AppBar,
    AppShell,
    type DrawerSettings,
    getDrawerStore
  } from '@skeletonlabs/skeleton';
  import type { DashboardUser } from './+page.server';
  import Feed from '../../../components/dashboard/feed.svelte';
  import LeftSideBar from '../../../components/dashboard/leftSidebar/leftSideBar.svelte';
  import { enhance } from '$app/forms';
  import FaHome from 'svelte-icons/fa/FaHome.svelte';
  import FaUsers from 'svelte-icons/fa/FaUsers.svelte';
  import FaLayerGroup from 'svelte-icons/fa/FaLayerGroup.svelte';
  import FaChartBar from 'svelte-icons/fa/FaChartBar.svelte';
  import FaFileAlt from 'svelte-icons/fa/FaFileAlt.svelte';
  import FaBriefcase from 'svelte-icons/fa/FaBriefcase.svelte';
  import FaStar from 'svelte-icons/fa/FaStar.svelte';
  import FaShieldAlt from 'svelte-icons/fa/FaShieldAlt.svelte';
  import FaTerminal from 'svelte-icons/fa/FaTerminal.svelte';

  import type { Prisma } from '@prisma/client';
  export let data: { user: DashboardUser | null; surveyDateUpdated: Date | undefined; joinableProjects: Prisma.ProjectGetPayload<{ include: { logo: true } }>[]; member?: { id: string }; isSummerPeriod: boolean; isGracePeriod: boolean; gracePeriodExpiry: Date | null; currentYear: number; currentSemester: import('@prisma/client').Season };
  const drawerStore = getDrawerStore();
  const drawerSettingsLeft: DrawerSettings = {
    id: 'dashboard1',
    meta: {
      projects: data.user?.Projects,
      joinableProjects: data.joinableProjects,
      currentYear: data.currentYear,
      currentSemester: data.currentSemester
    }
  };

  let promptSurveyUpdate = false;
  const surveyDateUpdated = new Date(data.user?.Survey?.DateUpdated!);
  const currentDate = new Date();

  const getPeriodStartDate = (month: number) => new Date(currentDate.getFullYear(), month, 1);

  const checkPeriods = [
    { start: getPeriodStartDate(0), end: getPeriodStartDate(4) },
    { start: getPeriodStartDate(4), end: getPeriodStartDate(8) },
    { start: getPeriodStartDate(8), end: getPeriodStartDate(0) }
  ];

  for (let period of checkPeriods) {
    if (currentDate >= period.end && surveyDateUpdated < period.end && surveyDateUpdated >= period.start) {
      promptSurveyUpdate = true;
      break;
    }
  }

  function titleCase(s: string): string {
    return s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  $: userRole = data.user?.role ?? { name: 'guest', permissionLevel: 0 };
  $: memberExpired = (data.user?.membershipExpDate.getTime() ?? 0) < new Date().getTime();

  let calendarOutput: string[] | null = null;
  let calendarLoading = false;
  let calendarError: string | null = null;

  async function runCalendarDiagnostic() {
    calendarLoading = true;
    calendarError = null;
    calendarOutput = null;
    try {
      const res = await fetch('/api/ucf-calendar-status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      calendarOutput = data.lines;
    } catch (e) {
      calendarError = String(e);
    } finally {
      calendarLoading = false;
    }
  }

  let sweepOutput: string[] | null = null;
  let sweepLoading = false;
  let sweepError: string | null = null;

  async function runMembershipSweep() {
    sweepLoading = true;
    sweepError = null;
    sweepOutput = null;
    try {
      const res = await fetch('/api/sweep-memberships', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      sweepOutput = data.lines;
    } catch (e) {
      sweepError = String(e);
    } finally {
      sweepLoading = false;
    }
  }
</script>

<AppShell>
  <svelte:fragment slot="header">
    <AppBar>
      <svelte:fragment slot="lead">
        <button
          class="block lg:hidden btn variant-ghost-tertiary hover:variant-filled-tertiary"
          on:click={() => drawerStore.open(drawerSettingsLeft)}>
          Projects
        </button>
      </svelte:fragment>
    </AppBar>
  </svelte:fragment>

  <svelte:fragment slot="sidebarLeft">
    {#if !memberExpired}
      <div id="sidebar-left" class="hidden lg:block">
        <LeftSideBar projects={data.user?.Projects} joinableProjects={data.joinableProjects} currentYear={data.currentYear} currentSemester={data.currentSemester} />
      </div>
    {/if}
  </svelte:fragment>

  {#if data.user && data.user.surveyId !== null}
    {#if promptSurveyUpdate}
      <div class="p-4">
        <div class="card p-6">
          <h2 class="h2">Your member survey has expired</h2>
          <p class="mt-2 opacity-60 text-sm">
            Update it from your profile — click your avatar in the top right corner.
          </p>
        </div>
      </div>

    {:else}
      <div class="p-4 space-y-4">

        <!-- Welcome card -->
        <div class="card p-6">
          <h2 class="h2">
            Hello, {data.user?.firstName}{data.user?.lastName ? ` ${data.user.lastName}` : ''}
          </h2>
          <div class="mt-4">
            {#if memberExpired && data.isSummerPeriod}
              {#if data.user?.id}
                <form action="?/summerRole" method="post" use:enhance>
                  <input type="hidden" name="id" bind:value={data.user.id} />
                  <button type="submit" class="btn variant-ghost-tertiary hover:variant-filled-tertiary">
                    Join as a Summer Member
                  </button>
                </form>
              {/if}
            {:else if memberExpired && data.isGracePeriod}
              {#if data.user?.id}
                <form action="?/graceRole" method="post" use:enhance>
                  <input type="hidden" name="id" bind:value={data.user.id} />
                  <button type="submit" class="btn variant-ghost-tertiary hover:variant-filled-tertiary">
                    Join as a Trial Member
                  </button>
                </form>
                <p class="text-xs opacity-50 mt-2">
                  Free 2-week trial · expires {data.gracePeriodExpiry ? new Date(data.gracePeriodExpiry).toDateString() : ''}
                </p>
              {/if}
            {:else if memberExpired}
              <span class="badge variant-filled-error">Dues Expired</span>
              <div class="mt-4">
                <a href="/dashboard/acknowledge" class="btn variant-ghost-tertiary hover:variant-filled-tertiary">
                  Pay Dues
                </a>
              </div>
            {:else}
              <span class="badge variant-filled-success">
                Active — expires {data.user?.membershipExpDate.toDateString()}
              </span>
              <p class="text-xs opacity-40 mt-2">
                Discord roles update every 15 minutes after payment.
              </p>
            {/if}
          </div>
        </div>

        {#if !memberExpired}

          <!-- Staff dashboard -->
          {#if userRole.permissionLevel > 4}
            <div class="card p-6 space-y-6">

              <!-- Section header -->
              <div class="flex items-center gap-3">
                <div class="w-6 h-6 opacity-60 shrink-0"><FaShieldAlt /></div>
                <h2 class="h2">{titleCase(userRole.name)} Dashboard</h2>
              </div>

              {#if userRole.permissionLevel >= 8}

                {#if userRole.permissionLevel >= 10}
                <!-- Website & Content -->
                <div>
                  <p class="text-xs font-bold uppercase tracking-widest opacity-40 mb-3">
                    Website &amp; Content
                  </p>
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <a href="/api/edit-mode?enable=true&to=/" class="card p-4 hover:card-hover">
                      <div class="flex items-center gap-3">
                        <div class="w-5 h-5 shrink-0 opacity-50"><FaHome /></div>
                        <div>
                          <p class="font-semibold text-sm">Edit Home Page</p>
                          <p class="text-xs opacity-50">Edit public content inline</p>
                        </div>
                      </div>
                    </a>
                    <a href="/api/edit-mode?enable=true&to=/sponsors" class="card p-4 hover:card-hover">
                      <div class="flex items-center gap-3">
                        <div class="w-5 h-5 shrink-0 opacity-50"><FaStar /></div>
                        <div>
                          <p class="font-semibold text-sm">Edit Sponsors Page</p>
                          <p class="text-xs opacity-50">Titles, tiers &amp; benefits</p>
                        </div>
                      </div>
                    </a>
                    <a href="/dashboard/manage-sponsors" class="card p-4 hover:card-hover">
                      <div class="flex items-center gap-3">
                        <div class="w-5 h-5 shrink-0 opacity-50"><FaBriefcase /></div>
                        <div>
                          <p class="font-semibold text-sm">Manage Sponsors</p>
                          <p class="text-xs opacity-50">Add, edit, or remove sponsors</p>
                        </div>
                      </div>
                    </a>
                  </div>
                </div>
                {/if}

                <!-- Members & Projects -->
                <div>
                  <p class="text-xs font-bold uppercase tracking-widest opacity-40 mb-3">
                    Members &amp; Projects
                  </p>
                  <div class="grid grid-cols-1 {userRole.permissionLevel >= 10 ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-3">
                    <a href="/dashboard/admin" class="card p-4 hover:card-hover">
                      <div class="flex items-center gap-3">
                        <div class="w-5 h-5 shrink-0 opacity-50"><FaUsers /></div>
                        <div>
                          <p class="font-semibold text-sm">Manage Roles</p>
                          <p class="text-xs opacity-50">View and assign member roles</p>
                        </div>
                      </div>
                    </a>
                    <a href="/dashboard/manage-project" class="card p-4 hover:card-hover">
                      <div class="flex items-center gap-3">
                        <div class="w-5 h-5 shrink-0 opacity-50"><FaLayerGroup /></div>
                        <div>
                          <p class="font-semibold text-sm">Manage Projects</p>
                          <p class="text-xs opacity-50">Create, edit, or duplicate</p>
                        </div>
                      </div>
                    </a>
                    {#if userRole.permissionLevel >= 10}
                    <a href="/dashboard/statistics" class="card p-4 hover:card-hover">
                      <div class="flex items-center gap-3">
                        <div class="w-5 h-5 shrink-0 opacity-50"><FaChartBar /></div>
                        <div>
                          <p class="font-semibold text-sm">Statistics</p>
                          <p class="text-xs opacity-50">Membership breakdowns</p>
                        </div>
                      </div>
                    </a>
                    {/if}
                  </div>
                </div>

                {#if userRole.permissionLevel >= 10}
                <!-- Settings -->
                <div>
                  <p class="text-xs font-bold uppercase tracking-widest opacity-40 mb-3">Settings</p>
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <a href="/dashboard/acknowledge" class="card p-4 hover:card-hover">
                      <div class="flex items-center gap-3">
                        <div class="w-5 h-5 shrink-0 opacity-50"><FaFileAlt /></div>
                        <div>
                          <p class="font-semibold text-sm">Dues Agreement</p>
                          <p class="text-xs opacity-50">Edit acknowledgement message</p>
                        </div>
                      </div>
                    </a>
                    <button
                      class="card p-4 hover:card-hover text-left"
                      disabled={calendarLoading}
                      on:click={runCalendarDiagnostic}
                    >
                      <div class="flex items-center gap-3">
                        <div class="w-5 h-5 shrink-0 opacity-50"><FaTerminal /></div>
                        <div>
                          <p class="font-semibold text-sm">UCF Calendar Diagnostic</p>
                          <p class="text-xs opacity-50">{calendarLoading ? 'Running...' : 'Test semester date integration'}</p>
                        </div>
                      </div>
                    </button>
                    <button
                      class="card p-4 hover:card-hover text-left"
                      disabled={sweepLoading}
                      on:click={runMembershipSweep}
                    >
                      <div class="flex items-center gap-3">
                        <div class="w-5 h-5 shrink-0 opacity-50"><FaTerminal /></div>
                        <div>
                          <p class="font-semibold text-sm">Run Expiration Sweep</p>
                          <p class="text-xs opacity-50">{sweepLoading ? 'Running...' : 'Expire overdue memberships now'}</p>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
                {/if}

              {/if}
            </div>
          {/if}

          {#if calendarOutput !== null || calendarLoading || calendarError}
            <div class="card p-6">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-5 h-5 shrink-0 opacity-60"><FaTerminal /></div>
                <h3 class="h3">UCF Calendar Output</h3>
              </div>
              <div class="rounded-lg p-4 font-mono text-xs overflow-y-auto max-h-80 space-y-0.5" style="background:#0d1117; color:#c9d1d9;">
                {#if calendarLoading}
                  <p class="opacity-50">Running diagnostic...</p>
                {:else if calendarError}
                  <p style="color:#f85149;">{calendarError}</p>
                {:else if calendarOutput}
                  {#each calendarOutput as line}
                    <p class="leading-relaxed whitespace-pre">{line}</p>
                  {/each}
                {/if}
              </div>
            </div>
          {/if}

          {#if sweepOutput !== null || sweepLoading || sweepError}
            <div class="card p-6">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-5 h-5 shrink-0 opacity-60"><FaTerminal /></div>
                <h3 class="h3">Expiration Sweep Output</h3>
              </div>
              <div class="rounded-lg p-4 font-mono text-xs overflow-y-auto max-h-80 space-y-0.5" style="background:#0d1117; color:#c9d1d9;">
                {#if sweepLoading}
                  <p class="opacity-50">Running sweep...</p>
                {:else if sweepError}
                  <p style="color:#f85149;">{sweepError}</p>
                {:else if sweepOutput}
                  {#each sweepOutput as line}
                    <p class="leading-relaxed whitespace-pre">{line}</p>
                  {/each}
                {/if}
              </div>
            </div>
          {/if}

          <Feed />
        {/if}

      </div>
    {/if}

  {:else}
    <div class="p-4">
      <div class="card p-6">
        <h2 class="h2">No member survey on file</h2>
        <p class="mt-2 opacity-60 text-sm">
          The member survey is required before joining RCCF. It takes 1–3 minutes and can be updated later from your profile.
        </p>
        <div class="mt-4">
          <a href="/dashboard/survey" class="btn variant-ghost-tertiary hover:variant-filled-tertiary">
            Create Member Survey
          </a>
        </div>
      </div>
    </div>
  {/if}
</AppShell>

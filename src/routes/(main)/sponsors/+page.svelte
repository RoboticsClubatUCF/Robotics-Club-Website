<script lang="ts">
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import EditableText from '../../../components/EditableText.svelte';
  import type { PageData } from './$types';
  export let data: PageData;

  type TierKey = 'processor' | 'circuit' | 'bolt' | 'aluminum';

  const TIER_PRIORITY: Record<TierKey, number> = { processor: 0, circuit: 1, bolt: 2, aluminum: 3 };

  // Top 5 sponsors sorted by tier priority (highest tier first)
  $: topSponsors = [...data.sponsors]
    .sort((a, b) => TIER_PRIORITY[a.tier as TierKey] - TIER_PRIORITY[b.tier as TierKey])
    .slice(0, 5);

  // Duration scales with total character count so long names don't race past
  $: scrollDuration = Math.max(
    8,
    topSponsors.reduce((sum, s) => sum + s.name.length, 0) * 0.4 + topSponsors.length * 2
  );

  // ----- tier benefit CRUD -----
  type BenefitEdit = { tierKey: TierKey; index: number } | null;
  let editingBenefit: BenefitEdit = null;
  let editBenefitText = '';
  let saving = false;
  let saveError = '';

  let tierBenefits: Record<TierKey, string[]> = {
    processor: [...data.siteContent.tiers.processor.benefits],
    circuit: [...data.siteContent.tiers.circuit.benefits],
    bolt: [...data.siteContent.tiers.bolt.benefits],
    aluminum: [...data.siteContent.tiers.aluminum.benefits]
  };

  async function saveBenefits(tierKey: TierKey) {
    saving = true; saveError = '';
    try {
      const res = await fetch('/api/site-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: `sponsors.tier.${tierKey}.benefits`,
          value: JSON.stringify(tierBenefits[tierKey]),
          type: 'text'
        })
      });
      if (!res.ok) saveError = 'Save failed.';
    } catch { saveError = 'Network error.'; }
    finally { saving = false; }
  }

  function startEditBenefit(tierKey: TierKey, i: number) {
    editingBenefit = { tierKey, index: i };
    editBenefitText = tierBenefits[tierKey][i];
  }

  async function saveBenefit() {
    if (!editingBenefit) return;
    const { tierKey, index } = editingBenefit;
    tierBenefits[tierKey][index] = editBenefitText;
    tierBenefits = { ...tierBenefits };
    await saveBenefits(tierKey);
    if (!saveError) editingBenefit = null;
  }

  async function deleteBenefit(tierKey: TierKey, i: number) {
    tierBenefits[tierKey] = tierBenefits[tierKey].filter((_, idx) => idx !== i);
    tierBenefits = { ...tierBenefits };
    await saveBenefits(tierKey);
  }

  async function addBenefit(tierKey: TierKey) {
    tierBenefits[tierKey] = [...tierBenefits[tierKey], 'New benefit'];
    tierBenefits = { ...tierBenefits };
    await saveBenefits(tierKey);
    startEditBenefit(tierKey, tierBenefits[tierKey].length - 1);
  }

  const TIER_ORDER: TierKey[] = ['processor', 'circuit', 'bolt', 'aluminum'];
  const TIER_CLASSES: Record<TierKey, string> = {
    processor: 'processorPatron',
    circuit: 'circuitSupporter',
    bolt: 'boltBacker',
    aluminum: 'aluminumAlly'
  };
</script>

<div class="sponsors-page">

<!-- Edit-mode quick-access bar -->
{#if data.editMode}
  <div class="w-full bg-surface-200-700-token flex items-center justify-between px-4 py-2 border-b border-surface-300-600-token">
    <span class="text-xs opacity-60 font-semibold uppercase tracking-wide">Editing sponsors page</span>
    <a
      href="/dashboard/manage-sponsors"
      class="btn btn-sm variant-filled-primary"
    >
      Manage Sponsors (add / remove) →
    </a>
  </div>
{/if}

<!-- Scroller section -->
<div>
  <div class="h1 text-[2rem] sm:text-[3.5rem] md:text-[5rem] leading-tight sm:leading-[5rem] text-center p-[3%]">
    <EditableText
      contentKey="sponsors.scroller.title"
      value={data.siteContent.scrollerTitle}
      editMode={data.editMode}
      multiline={false}
    />
  </div>

  <!-- Animated scroller — 2 identical copies so animation translates exactly -50% -->
  {#if topSponsors.length > 0}
    <div class="scroller-container">
      <div class="scroller-inner" style="--scroll-duration: {scrollDuration}s">
        {#each [...topSponsors, ...topSponsors] as sponsor, i (i)}
          <img src={sponsor.imageUrl} alt={sponsor.name} width="70px" />
          <div class="content-item">{sponsor.name}<br /></div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Sponsorship Tiers -->
<div class="w-full flex justify-center py-8 px-2 sm:px-4 mt-[50px] pb-[80px]">
  <div class={$modeCurrent
    ? 'block card p-4 sm:p-8 pointer-events-auto shadow-xl shadow-surface-300 w-full max-w-3xl'
    : 'block card p-4 sm:p-8 pointer-events-auto shadow-xl shadow-surface-500 w-full max-w-3xl'}>
    <div class="m-2 sm:m-4 centered">
      <div class="sponsorContainer sponsor-wrapper">
        <div class="centered">
          <div class="h1 text-[2rem] sm:text-[3.5rem] md:text-[5rem] leading-tight sm:leading-[5rem]">
            <EditableText
              contentKey="sponsors.tiers.title"
              value={data.siteContent.tiersTitle}
              editMode={data.editMode}
              multiline={false}
            />
          </div>
          <br />
          <div class="sponsorshipTiers">
            {#each TIER_ORDER as tierKey}
              {@const tier = data.siteContent.tiers[tierKey]}
              {@const tierClass = TIER_CLASSES[tierKey]}
              {@const tieredSponsors = data.sponsors.filter((s) => s.tier === tierKey)}

              <div class={tierClass}>
                <div>
                  <EditableText
                    contentKey="sponsors.tier.{tierKey}.name"
                    value={tier.name}
                    editMode={data.editMode}
                    multiline={false}
                  />
                </div>
                <div>
                  <EditableText
                    contentKey="sponsors.tier.{tierKey}.amount"
                    value={tier.amount}
                    editMode={data.editMode}
                    multiline={false}
                  />
                </div>
              </div>

              <ul class="tierInfo">
                {#each tierBenefits[tierKey] as benefit, bi (bi)}
                  {#if data.editMode && editingBenefit?.tierKey === tierKey && editingBenefit?.index === bi}
                    <li class="flex gap-1 items-center">
                      <input
                        type="text"
                        bind:value={editBenefitText}
                        class="input input-sm flex-1"
                      />
                      <button on:click={saveBenefit} disabled={saving} class="btn btn-sm variant-filled-success">✓</button>
                      <button on:click={() => (editingBenefit = null)} class="btn btn-sm variant-ghost">✕</button>
                    </li>
                  {:else}
                    <li class="flex items-center gap-1 group/benefit">
                      {benefit}
                      {#if data.editMode}
                        <button
                          on:click={() => startEditBenefit(tierKey, bi)}
                          class="btn btn-sm variant-filled-warning px-1 py-0 opacity-0 group-hover/benefit:opacity-100 transition-opacity text-xs"
                        >✎</button>
                        <button
                          on:click={() => deleteBenefit(tierKey, bi)}
                          class="btn btn-sm variant-filled-error px-1 py-0 opacity-0 group-hover/benefit:opacity-100 transition-opacity text-xs"
                        >×</button>
                      {/if}
                    </li>
                  {/if}
                {/each}
                {#if data.editMode}
                  <li>
                    <button
                      on:click={() => addBenefit(tierKey)}
                      disabled={saving}
                      class="btn btn-sm variant-ghost-success text-xs mt-1"
                    >+ Add benefit</button>
                  </li>
                {/if}

                <p>Current Supporters:</p>
                <div class="currentSupporters">
                  {#each tieredSponsors as sponsor}
                    <div class="sponsor-logo">
                      <a href={sponsor.link} target="_blank" rel="noopener noreferrer">
                        <img src={sponsor.imageUrl} alt={sponsor.name} />
                      </a>
                    </div>
                  {/each}
                  {#if tieredSponsors.length === 0}
                    <p class="text-xs opacity-40 italic">No sponsors at this tier yet.</p>
                  {/if}
                </div>
              </ul>
            {/each}
          </div>
        </div>
      </div>

      <hr class="border" />
      <div class="sponsorInfo">
        <EditableText
          contentKey="sponsors.notes"
          value={data.siteContent.notes}
          editMode={data.editMode}
        />
        <br />
        Become a sponsor by reaching out to
        {#if data.editMode}
          <div class="mt-1">
            <span class="text-xs opacity-60">Contact email:</span>
            <EditableText
              contentKey="sponsors.contact.email"
              value={data.siteContent.contactEmail}
              editMode={data.editMode}
              multiline={false}
            />
          </div>
        {:else}
          <a href="mailto:{data.siteContent.contactEmail}" class="text-blue-500 underline">
            {data.siteContent.contactEmail}
          </a>
        {/if}
      </div>
    </div>
  </div>
</div>

</div>

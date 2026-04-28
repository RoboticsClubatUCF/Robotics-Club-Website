<script lang="ts">
  import { injectDots } from '../../../components/pixijs/dotsAnimation';
  import { modeCurrent } from '@skeletonlabs/skeleton';
  import EditableText from '../../../components/EditableText.svelte';
  import type { PageData } from './$types';
  export let data: PageData;

  type Sponsor = { name: string; imageUrl: string; link: string; tier: string };
  type TierKey = 'processor' | 'circuit' | 'bolt' | 'aluminum';

  let sponsors: Sponsor[] = [...data.sponsors];
  let saving = false;
  let saveError = '';

  // ----- dot animation -----
  let mainEle: HTMLElement;
  let dotsInjected = false;
  function updateDots() {
    if (!mainEle) return;
    if (!$modeCurrent && !dotsInjected) { injectDots(mainEle, 200); dotsInjected = true; }
    else if (dotsInjected) {
      const canvas = mainEle.querySelector('canvas');
      if (canvas) { canvas.remove(); dotsInjected = false; }
    }
  }
  $: $modeCurrent, mainEle && updateDots();

  // ----- sponsor CRUD -----
  let editingSponsorIndex: number | null = null;
  let editSponsor: Sponsor = { name: '', imageUrl: '', link: '', tier: 'processor' };

  async function saveSponsors(updated: Sponsor[]) {
    saving = true; saveError = '';
    try {
      const res = await fetch('/api/site-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'sponsors.list', value: JSON.stringify(updated), type: 'text' })
      });
      if (!res.ok) saveError = 'Save failed.';
    } catch { saveError = 'Network error.'; }
    finally { saving = false; }
  }

  function startEditSponsor(i: number) {
    editingSponsorIndex = i;
    editSponsor = { ...sponsors[i] };
  }

  async function saveSponsorItem(i: number) {
    const updated = [...sponsors];
    updated[i] = { ...editSponsor };
    await saveSponsors(updated);
    if (!saveError) { sponsors = updated; editingSponsorIndex = null; }
  }

  async function deleteSponsor(i: number) {
    if (!confirm('Remove this sponsor?')) return;
    const updated = sponsors.filter((_, idx) => idx !== i);
    await saveSponsors(updated);
    if (!saveError) sponsors = updated;
  }

  async function addSponsor() {
    const updated = [...sponsors, { name: 'New Sponsor', imageUrl: '', link: 'https://', tier: 'aluminum' }];
    await saveSponsors(updated);
    if (!saveError) { sponsors = updated; startEditSponsor(updated.length - 1); }
  }

  // ----- tier benefit CRUD -----
  type BenefitEdit = { tierKey: TierKey; index: number } | null;
  let editingBenefit: BenefitEdit = null;
  let editBenefitText = '';

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

<!-- Scroller section -->
<div>
  <div class="h1 text-[5rem] leading-[5rem] text-center p-[3%]">
    <EditableText
      contentKey="sponsors.scroller.title"
      value={data.siteContent.scrollerTitle}
      editMode={data.editMode}
      multiline={false}
    />
  </div>

  {#if data.editMode}
    <!-- Sponsor manager -->
    <div class="p-4 space-y-3 max-w-3xl mx-auto">
      <div class="flex items-center justify-between">
        <h3 class="h4">Manage Sponsors</h3>
        <button on:click={addSponsor} disabled={saving} class="btn btn-sm variant-ghost-success">
          + Add Sponsor
        </button>
      </div>
      {#if saveError}<p class="text-error-500 text-sm">{saveError}</p>{/if}

      {#each sponsors as sponsor, i (i)}
        {#if editingSponsorIndex === i}
          <div class="card p-4 border-2 border-warning-500 space-y-2">
            <div class="grid grid-cols-2 gap-2">
              <label class="label">
                <span class="text-xs font-bold">Name</span>
                <input type="text" bind:value={editSponsor.name} class="input" />
              </label>
              <label class="label">
                <span class="text-xs font-bold">Tier</span>
                <select bind:value={editSponsor.tier} class="select">
                  <option value="processor">Processor Patron ($5,000+)</option>
                  <option value="circuit">Circuit Supporter (up to $3,000)</option>
                  <option value="bolt">Bolt Backer (up to $1,000)</option>
                  <option value="aluminum">Aluminum Ally ($250)</option>
                </select>
              </label>
            </div>
            <label class="label">
              <span class="text-xs font-bold">Logo Image URL</span>
              <input type="text" bind:value={editSponsor.imageUrl} class="input" placeholder="https://…" />
            </label>
            <label class="label">
              <span class="text-xs font-bold">Website Link</span>
              <input type="text" bind:value={editSponsor.link} class="input" placeholder="https://…" />
            </label>
            {#if editSponsor.imageUrl}
              <img src={editSponsor.imageUrl} alt="Preview" class="h-12 object-contain" />
            {/if}
            <div class="flex gap-2">
              <button on:click={() => saveSponsorItem(i)} disabled={saving} class="btn btn-sm variant-filled-success">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button on:click={() => (editingSponsorIndex = null)} class="btn btn-sm variant-ghost">Cancel</button>
            </div>
          </div>
        {:else}
          <div class="card p-3 flex items-center gap-3">
            {#if sponsor.imageUrl}
              <img src={sponsor.imageUrl} alt={sponsor.name} class="h-10 w-10 object-contain shrink-0" />
            {:else}
              <div class="h-10 w-10 bg-surface-300-600-token rounded shrink-0" />
            {/if}
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-sm">{sponsor.name}</p>
              <p class="text-xs opacity-50 capitalize">{sponsor.tier} · <a href={sponsor.link} target="_blank" class="underline">{sponsor.link}</a></p>
            </div>
            <div class="flex gap-1 shrink-0">
              <button on:click={() => startEditSponsor(i)} class="btn btn-sm variant-filled-warning">Edit</button>
              <button on:click={() => deleteSponsor(i)} class="btn btn-sm variant-filled-error" title="Remove">×</button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <!-- Animated scroller -->
    <div class="scroller-container">
      <div class="scroller-inner">
        {#each [...sponsors, ...sponsors, ...sponsors, ...sponsors] as sponsor, i (i)}
          <img src={sponsor.imageUrl} alt={sponsor.name} width="70px" />
          <div class="content-item">{sponsor.name}<br /></div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Sponsorship Tiers -->
<div bind:this={mainEle} class="absolute top-0 left-0 right-0 bottom-0 pointer-events-auto -z-20" />
<div class="h-screen grid place-items-center w-screen top-0 pointer-events-none mt-[50px] pb-[130px]">
  <div class={$modeCurrent
    ? 'block card p-8 pointer-events-auto shadow-xl shadow-surface-300'
    : 'block card p-8 pointer-events-auto shadow-xl shadow-surface-500'}>
    <div class="m-4 centered">
      <div class="sponsorContainer sponsor-wrapper">
        <div class="centered">
          <div class="h1 text-[5rem] leading-[5rem]">
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
              {@const tieredSponsors = sponsors.filter((s) => s.tier === tierKey)}

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

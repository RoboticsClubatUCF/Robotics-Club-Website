<script lang="ts">
  import { Accordion, AccordionItem } from '@skeletonlabs/skeleton';

  type FaqItem = { question: string; answer: string };

  export let items: FaqItem[] = [];
  export let editMode: boolean = false;

  const DEFAULTS: FaqItem[] = [
    {
      question: 'Do I need experience to join?',
      answer:
        'No, all projects are drop-in certified, so no skills or experience are required for you to join a project! It is, however, required that you become a member before participating in any projects.'
    },
    {
      question: 'How much is membership?',
      answer:
        'Membership is $25 a semester and $50 a year. There will be times in which the lab is open during the summer and during those times membership is completely free!'
    },
    {
      question: 'How do I become a member?',
      answer:
        "Becoming a member is as easy as:\n1. Create an RCCF web account by going to sign in → become a member\n2. Fill out your members' survey and pay dues\n3. Join a general body meeting (times posted on Discord)"
    },
    {
      question: 'Can I create my own project?',
      answer:
        'It depends, the approval or denial of a project depends on the number of people interested, the allowed budget, and general approval from administration. If you truly want to start your own project within RCCF start by talking to Crystal or the president.'
    },
    {
      question: 'Can I pay for something to be 3D printed?',
      answer:
        'Yes! Price will vary depending on the size and in-fill of the print. Other than that just make sure you ask early on as we have a lot of projects that require 3D printing and those come first.'
    },
    {
      question: 'Where is the lab located?',
      answer:
        "We are located in UCF's Institute For Simulation & Training at 3100 Technology Pkwy, Orlando, FL 32826."
    },
    {
      question: 'How do I join a project?',
      answer:
        "Joining a project is easy. Once you've become a member and paid your dues head over to the discord and in bot-cmds type in /teams to pull up all the projects and then all you have to do is pick the ones you want to join. Of course, show up to the meetings as well."
    },
    {
      question: 'How do sponsorships work?',
      answer:
        "If you would like to sponsor us check out what we offer in our sponsors' page, otherwise it's basically a way to financially support RCCF and its mission."
    }
  ];

  let displayItems: FaqItem[] = items.length > 0 ? [...items] : [...DEFAULTS];

  let editingIndex: number | null = null;
  let editQuestion = '';
  let editAnswer = '';
  let saving = false;
  let saveError = '';

  async function saveAll(updated: FaqItem[]) {
    saving = true;
    saveError = '';
    try {
      const res = await fetch('/api/site-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'home.faq.items', value: JSON.stringify(updated), type: 'text' })
      });
      if (!res.ok) saveError = 'Save failed.';
    } catch {
      saveError = 'Network error.';
    } finally {
      saving = false;
    }
  }

  function startEdit(i: number) {
    editingIndex = i;
    editQuestion = displayItems[i].question;
    editAnswer = displayItems[i].answer;
  }

  async function saveItem(i: number) {
    const updated = [...displayItems];
    updated[i] = { question: editQuestion, answer: editAnswer };
    await saveAll(updated);
    if (!saveError) {
      displayItems = updated;
      editingIndex = null;
    }
  }

  async function deleteItem(i: number) {
    if (!confirm('Delete this FAQ item?')) return;
    const updated = displayItems.filter((_, idx) => idx !== i);
    await saveAll(updated);
    if (!saveError) displayItems = updated;
  }

  async function addItem() {
    const updated = [...displayItems, { question: 'New Question', answer: 'Answer here.' }];
    await saveAll(updated);
    if (!saveError) {
      displayItems = updated;
      startEdit(updated.length - 1);
    }
  }

  function moveUp(i: number) {
    if (i === 0) return;
    const updated = [...displayItems];
    [updated[i - 1], updated[i]] = [updated[i], updated[i - 1]];
    displayItems = updated;
    saveAll(updated);
  }

  function moveDown(i: number) {
    if (i === displayItems.length - 1) return;
    const updated = [...displayItems];
    [updated[i], updated[i + 1]] = [updated[i + 1], updated[i]];
    displayItems = updated;
    saveAll(updated);
  }
</script>

{#if editMode}
  <!-- Edit mode: flat list with controls -->
  <div class="space-y-3 mt-4">
    {#each displayItems as item, i (i)}
      {#if editingIndex === i}
        <div class="card p-4 border-2 border-warning-500 space-y-2">
          <label class="label">
            <span class="text-xs font-bold">Question</span>
            <input type="text" bind:value={editQuestion} class="input" />
          </label>
          <label class="label">
            <span class="text-xs font-bold">Answer</span>
            <textarea bind:value={editAnswer} class="textarea text-sm" rows="4" />
          </label>
          {#if saveError}<p class="text-error-500 text-xs">{saveError}</p>{/if}
          <div class="flex gap-2">
            <button
              on:click={() => saveItem(i)}
              disabled={saving}
              class="btn btn-sm variant-filled-success"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button on:click={() => (editingIndex = null)} class="btn btn-sm variant-ghost">
              Cancel
            </button>
          </div>
        </div>
      {:else}
        <div class="card p-3 flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm truncate">{item.question}</p>
            <p class="text-xs opacity-60 line-clamp-2">{item.answer}</p>
          </div>
          <div class="flex gap-1 shrink-0">
            <button
              on:click={() => moveUp(i)}
              disabled={i === 0}
              class="btn btn-sm variant-ghost px-2"
              title="Move up">↑</button
            >
            <button
              on:click={() => moveDown(i)}
              disabled={i === displayItems.length - 1}
              class="btn btn-sm variant-ghost px-2"
              title="Move down">↓</button
            >
            <button on:click={() => startEdit(i)} class="btn btn-sm variant-filled-warning">
              Edit
            </button>
            <button
              on:click={() => deleteItem(i)}
              class="btn btn-sm variant-filled-error"
              title="Delete">×</button
            >
          </div>
        </div>
      {/if}
    {/each}
    <button on:click={addItem} disabled={saving} class="btn btn-sm variant-ghost-success w-full">
      + Add Question
    </button>
    {#if saveError}<p class="text-error-500 text-xs">{saveError}</p>{/if}
  </div>
{:else}
  <!-- View mode: accordion -->
  <div class="mt-8">
    <Accordion class="card mt-8">
      {#each displayItems as item, i (i)}
        <AccordionItem>
          <svelte:fragment slot="summary"><strong>{item.question}</strong></svelte:fragment>
          <svelte:fragment slot="content">{item.answer}</svelte:fragment>
        </AccordionItem>
      {/each}
    </Accordion>
  </div>
{/if}

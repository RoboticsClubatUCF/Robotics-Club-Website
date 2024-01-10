<script lang="ts">
  import type { PageData } from './$types';
  //@ts-ignore
  import FaBook from 'svelte-icons/fa/FaBook.svelte';
  export let data: PageData;
</script>

<svelte:head>
  <title>{data.project.title}</title>
</svelte:head>
<div class=" p-4 m-2 grid-cols-1 md:grid-cols-2 grid gap-4">
  <div class="card p-4">
    <h2 class="h2 capitalize">{data.project.title}</h2>
    <br />
    <img class="rounded-md w-full" src={data.project.logo?.data} alt="" />
  </div>
  <div class="card p-4">
    <h3 class="h3">Season</h3>
    <p class="h4">{data.project.season}, {data.project.year}</p>
    <hr />
    <br />
    <h3 class="h3">Description</h3>
    <p>{data.project.description}</p>
    <hr />
    <br />
    <h3 class="h3">Skills</h3>
    {#each data.project.Skills as s}
      <span class="badge variant-filled m-1">{s}</span>
    {/each}
    <hr />
    <br />
    <h3 class="h3">Links</h3>
    <div class="logo-cloud grid-cols-1 lg:!grid-cols-3 gap-1">
      <a class="logo-item" href={data.project.docsLink}>
        <div class="h-10 w-10"><FaBook /></div>
        <span>Docs</span>
      </a>
      {#each data.project.extraLinks as link}
        <a class="logo-item" href={link.url}>
          <span>{link.label}</span>
        </a>
      {/each}
    </div>
    <hr />
    <br />
  </div>
  <div class="card p-4">
    <h3 class="h3">Members</h3>
    {#each data.project.members as m}
      <div class="card hover:card-hover variant-filled-surface p-1 m-2 flex">
        <a class="h5 flex-1 hover:animate-pulse" href={'/member/' + m.id}
          >{m.firstName} {m.lastName}</a
        >
        <p class="mr-5">{m.role.name}</p>
      </div>
    {/each}
  </div>
  <div class="card p-4">
    <h3 class="h3">Latest Updates</h3>
    <div class="grid grid-cols-1 grid-flow-row-dense">
      {#each data.project.articles as a}
        <a
          class="card hover:card-hover p-2 m-2 variant-filled-surface flex"
          href={'./' + data.project.id + '/articles#' + a.id}
        >
          <div>
            <img class="w-20 rounded-lg" src={a.image?.data} alt="" />
          </div>
          <div class="m-2">
            <div class="grid grid-cols-2 gap-5">
              <h4 class="h4">{a.title}</h4>
              <h4 class="h4">{new Date(a.createdAt).toDateString()}</h4>
            </div>
            <hr />
            <p>{a.content}</p>
            {#each a.Tags as t}
              <span class="badge variant-outline">{t.name}</span>
            {/each}
            <hr />
            <br />
            <p>
              Written By : <a class="h5 hover:animate-pulse" href={'/member/' + a.author.id}
                >{a.author.firstName}</a
              >
            </p>
          </div>
        </a>
      {/each}
    </div>
  </div>
</div>

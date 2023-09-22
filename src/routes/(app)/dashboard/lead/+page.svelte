<script lang="ts">
  import { superForm } from 'sveltekit-superforms/client';
  import type { PageData } from './$types';

  export let data: PageData;

  const { form, errors, constraints } = superForm(data.form, {
    clearOnSubmit: 'errors-and-message'
  });
</script>

<div class="m-4 p-2 card">
  <h2 class="h2">Create new Blogpost</h2>

  <br />
  <form action="?/blogPost" method="post">
    <label class="label">
      <span>Blogpost Title</span>
      <input
        type="text"
        name="title"
        id="title"
        class="input"
        placeholder="Progress report"
        bind:value={$form.title}
        {...$constraints.title}
        required
      />
    </label>
    <br />
    <label class="label">
      <span>Blogpost</span>
      <textarea
        name="blogpost"
        rows="4"
        id="blogpost"
        class="input"
        placeholder="Something something update update project stuff"
        bind:value={$form.blogpost}
        {...$constraints.blogpost}
        required
      />
    </label>
    <hr />
    <button class="btn" />
  </form>
</div>

<!-- be able to see all previous blogposts for this project -->

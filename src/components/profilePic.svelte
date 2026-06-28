<script lang="ts">
  import { Avatar } from '@skeletonlabs/skeleton';
  import { BackgroundSets, CharacterSets, generateAvatar } from 'robohash-avatars';
  import AdjustableImage from './AdjustableImage.svelte';
  import { parseImageRef } from '$lib/imageRef';

  export let hash: string;
  export let url: string | null | undefined = undefined;
  // Width class for the avatar (Skeleton-style, e.g. 'w-12').
  export let size: string = 'w-12';

  $: ref = parseImageRef(url);
  $: robohash = generateAvatar({
    username: hash,
    background: BackgroundSets.RandomBackground2,
    characters: CharacterSets.Robots,
    height: 200,
    width: 200
  });
</script>

{#if ref.src}
  <AdjustableImage value={url} alt="" frameClass="{size} aspect-square rounded-full" />
{:else}
  <Avatar src={robohash} width={size} />
{/if}

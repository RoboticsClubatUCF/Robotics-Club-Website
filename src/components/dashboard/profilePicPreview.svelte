<script lang="ts">
  import { Avatar } from '@skeletonlabs/skeleton';
  //@ts-ignore
  import { BackgroundSets, CharacterSets, generateAvatar } from 'robohash-avatars';

  export let hash: string;
  export let url: string | null | undefined = undefined;

  $: src = url || generateAvatar({
    username: hash,
    background: BackgroundSets.RandomBackground2,
    characters: CharacterSets.Robots,
    height: 500,
    width: 500
  });
</script>

<Avatar {src} class="w-full" />

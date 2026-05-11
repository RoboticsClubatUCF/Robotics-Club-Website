<script lang="ts">
  import { Avatar } from '@skeletonlabs/skeleton';
  import { BackgroundSets, CharacterSets, generateAvatar } from 'robohash-avatars';

  export let hash: string;
  export let url: string | null | undefined = undefined;

  $: src = url || generateAvatar({
    username: hash,
    background: BackgroundSets.RandomBackground2,
    characters: CharacterSets.Robots,
    height: 200,
    width: 200
  });
</script>

<Avatar {src} width="w-12" />

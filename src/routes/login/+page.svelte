<script lang="ts">
	import type { PageServerData } from './$types';
	import { superForm } from 'sveltekit-superforms/client';

	export let data: PageServerData;

	const { form } = superForm(data.form);
</script>

<!-- Form that provides a login screen, followed by the option to create your own account -->

<div class="block card card-hover p-4">
	<form method="POST">
		<label class="label">
			<span>First Name</span>
			<input type="text" name="name" id="name" class="input" />
		</label>
	</form>
</div>

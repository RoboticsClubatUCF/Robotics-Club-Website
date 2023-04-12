<script>
	import PasswordStrength from '../../components/password-strength.svelte';
	let password = '';
</script>

<div class="grid">
	<div class="form">
		<h1>Join the nerds</h1>
		<form action="?/createUser" method="post">
			<label for="name_first">First Name</label>
			<input type="text" id="name_first" name="name_first" required />
			<label for="name_last">Last Name</label>
			<input type="text" name="name_last" id="name_last" />
			<label for="email">Email</label>
			<input type="email" name="email" id="email" required />
			<label for="password">Password</label>
			<input type="password" name="password" id="password" required bind:value={password} />
			<PasswordStrength {password} />
			<button type="submit">Create Account</button>
		</form>
	</div>
</div>

<style>
	.grid {
		width: 100%;
		height: 100%;
		display: grid;
	}
	.form {
		justify-content: center;
		align-content: center;
	}
</style>

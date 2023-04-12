<script lang="ts">
	import './password-strength.css';
	import zxcvbn from 'zxcvbn';
	export let password = '';
	let score_text = '';
	let score_text_color = '';

	const default_style = 'bg-gray-200';

	let current_score = 0;

	const checkPassStrength = (password: string) => {
		current_score = zxcvbn(password).score;
	};

	$: checkPassStrength(password);

	const scoreStyle = (score: any) => {
		switch (score) {
			case 0:
				score_text = '';
				score_text_color = '';
				return '';
			case 1:
				score_text = 'Too Weak';
				score_text_color = 'text-red-600';
				return 'bg-red-600';
			case 2:
				score_text = 'Weak';
				score_text_color = 'text-yellow-600';
				return 'bg-yellow-600';
			case 3:
				score_text = 'Good';
				score_text_color = 'text-green-600';
				return 'bg-green-600';
			case 4:
				score_text = 'Strong';
				score_text_color = 'text-teal-600';
				return 'bg-teal-600';
			default:
				return 'bg-gray-200';
		}
	};

	const returnBarStyle = (bar: number, score: number) => {
		if (bar == 1 && score >= 1) {
			return scoreStyle(score);
		}
		if (bar == 2 && score >= 2) {
			return scoreStyle(score);
		}
		if (bar == 3 && score >= 3) {
			return scoreStyle(score);
		}
		if (bar == 4 && score == 4) {
			return scoreStyle(score);
		}
		return default_style;
	};
</script>

<div class="my-2">
	<ul class="grid grid-cols-12 gap-2">
		<li class={`col-span-3 h-1 rounded ${returnBarStyle(1, current_score)}`} />
		<li class={`col-span-3 h-1 rounded ${returnBarStyle(2, current_score)}`} />
		<li class={`col-span-3 h-1 rounded  ${returnBarStyle(3, current_score)}`} />
		<li class={`col-span-3 h-1 rounded  ${returnBarStyle(4, current_score)}`} />
	</ul>
	<div class={`text-right text-sm font-semibold ${score_text_color}`}>
		{score_text}
	</div>
</div>

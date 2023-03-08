<script>
	import Nav from "../components/nav.svelte";

</script>



<div>
    <Nav></Nav>
    <div class="page">
        <slot></slot>
    </div>
</div>



<style>
.page{
    position: absolute;
    top: 80px;
}
</style>
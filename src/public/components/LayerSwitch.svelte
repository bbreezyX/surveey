<script lang="ts">
  let { id, checked = $bindable(false) }: { id: string; checked?: boolean } = $props();
</script>
<span class="ctl-switch"><input type="checkbox" {id} bind:checked/><span class="ctl-switch__track" aria-hidden="true"><span class="ctl-switch__thumb"></span></span></span>

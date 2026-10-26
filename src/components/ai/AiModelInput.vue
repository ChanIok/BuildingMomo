<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Input } from '@/components/ui/input'
import type { AiModel } from '@/lib/ai/models'
import { useI18n } from '@/composables/useI18n'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue: string; models: readonly AiModel[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
const input = ref<InstanceType<typeof Input>>()
const opened = ref(false),
  active = ref(-1)
const filtered = computed(() => {
  const term = props.modelValue.trim().toLowerCase()
  // A selected ID should not hide every other model when reopening the picker.
  return !term || props.models.some((model) => model.id === props.modelValue)
    ? props.models
    : props.models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(term))
})
const expanded = computed(() => opened.value && !props.disabled && props.models.length > 0)
watch(filtered, () => {
  active.value = -1
})
watch(active, async (index) => {
  await nextTick()
  const element = input.value?.$el as HTMLInputElement | undefined
  element?.ownerDocument
    ?.getElementById(`ai-model-option-${index}`)
    ?.scrollIntoView({ block: 'nearest' })
})
function edit(value: string | number) {
  emit('update:modelValue', String(value))
  opened.value = true
  active.value = -1
}
function choose(model: AiModel) {
  emit('update:modelValue', model.id)
  opened.value = false
  active.value = -1
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape' && expanded.value) {
    event.preventDefault()
    event.stopPropagation()
    opened.value = false
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!props.models.length) return
    event.preventDefault()
    opened.value = true
    const length = filtered.value.length
    if (length)
      active.value =
        (active.value + (event.key === 'ArrowDown' ? 1 : active.value < 0 ? length : -1) + length) %
        length
  } else if (event.key === 'Enter' && expanded.value && active.value >= 0) {
    event.preventDefault()
    event.stopPropagation()
    choose(filtered.value[active.value]!)
  }
}
function focus() {
  ;(input.value?.$el as HTMLInputElement | undefined)?.focus()
  opened.value = true
}
defineExpose({ focus })
</script>

<template>
  <div class="relative">
    <Input
      ref="input"
      v-bind="$attrs"
      :model-value="modelValue"
      :disabled="disabled"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="expanded"
      aria-controls="ai-model-options"
      :aria-activedescendant="expanded && active >= 0 ? `ai-model-option-${active}` : undefined"
      autocomplete="off"
      @update:model-value="edit"
      @focus="opened = true"
      @blur="opened = false"
      @keydown="keydown"
    />
    <ul
      v-if="expanded"
      id="ai-model-options"
      role="listbox"
      :aria-label="t('ai.modelList')"
      class="absolute inset-x-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <li v-for="(model, index) in filtered" :key="model.id" role="presentation">
        <button
          :id="`ai-model-option-${index}`"
          type="button"
          role="option"
          :aria-selected="model.id === modelValue"
          tabindex="-1"
          class="w-full rounded px-2 py-2 text-left text-sm hover:bg-accent"
          :class="index === active ? 'bg-accent' : ''"
          @pointerdown.prevent
          @click="choose(model)"
          @pointermove="active = index"
        >
          <span class="block break-all">{{ model.name }}</span>
          <span
            v-if="model.name !== model.id"
            class="block font-mono text-xs break-all text-muted-foreground"
            >{{ model.id }}</span
          >
        </button>
      </li>
      <li
        v-if="!filtered.length"
        role="presentation"
        class="px-2 py-3 text-sm text-muted-foreground"
      >
        {{ t('ai.modelNoMatch') }}
      </li>
    </ul>
  </div>
</template>

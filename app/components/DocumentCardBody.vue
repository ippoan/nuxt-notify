<script setup lang="ts">
import { computed } from 'vue'
import {
  extractionBadge,
  distributionBadge,
  redactionBadge,
  buildLogisticsTitle,
  type BadgeView,
  type DocumentCardData,
} from '~/utils/documentBadges'

// DocumentCard の本体 (タイトル / 概要 / 送信者・日時 + redaction / extraction / distribution の 3 バッジ)。
// DocumentCard が NuxtLink (リンクにするとき) か div (しないとき) で包む。中身を 1 か所に書くために分けた。
// バッジ系は値が無いとき (extraction_status / distribution_status が未指定) は描画しない。

const props = defineProps<{ doc: DocumentCardData }>()

// 配車手配票の logistics が抽出済みなら「積込日時 積込県ー降し日時 降し県　輸送品名」
// を優先。無ければ従来どおり extracted_title || file_name にフォールバック (Refs #68)。
const title = computed(
  () =>
    buildLogisticsTitle(props.doc) ||
    props.doc.extracted_title ||
    props.doc.file_name ||
    'Untitled',
)
const subtitle = computed(
  () => props.doc.extracted_summary || props.doc.source_subject || '',
)
const redaction = computed<BadgeView | null>(() => redactionBadge(props.doc))
const dateLabel = computed(() =>
  new Date(props.doc.created_at).toLocaleString('ja-JP'),
)
</script>

<template>
  <div class="flex justify-between items-start gap-3">
    <div class="min-w-0 flex-1">
      <h3 class="font-semibold truncate">{{ title }}</h3>
      <p class="text-sm text-gray-500 mt-1 truncate">{{ subtitle }}</p>
      <p class="text-xs text-gray-400 mt-1">
        {{ doc.source_sender }} · {{ dateLabel }}
      </p>
    </div>
    <div class="flex gap-2 flex-shrink-0 flex-wrap justify-end">
      <span
        v-if="redaction"
        :class="['px-2 py-0.5 text-xs rounded-full', redaction.cls]"
      >
        {{ redaction.label }}
      </span>
      <span
        v-if="doc.extraction_status"
        :class="['px-2 py-0.5 text-xs rounded-full', extractionBadge(doc.extraction_status).cls]"
      >
        {{ extractionBadge(doc.extraction_status).label }}
      </span>
      <span
        v-if="doc.distribution_status"
        :class="['px-2 py-0.5 text-xs rounded-full', distributionBadge(doc.distribution_status).cls]"
      >
        {{ distributionBadge(doc.distribution_status).label }}
      </span>
    </div>
  </div>
</template>

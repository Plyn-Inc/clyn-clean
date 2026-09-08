export interface WorkScopeItem {
  space: string;
  icon: string;
  tasks: string[];
}

// 추후 수정이 필요하면 이 배열만 편집하면 됩니다.
export const WORK_SCOPES: WorkScopeItem[] = [
  {
    space: "주방",
    icon: "🍳",
    tasks: [
      "싱크대 내·외부 및 수전 청소",
      "가스레인지/인덕션 상판 청소",
      "타일 줄눈 및 벽면 오염 제거",
      "수납장 내부 청소",
    ],
  },
  {
    space: "화장실",
    icon: "🚿",
    tasks: [
      "변기, 세면대, 욕조 물때 제거",
      "타일·줄눈 일반 물때 및 표면 오염 청소",
      "배수구 청소",
      "거울 및 수전 광택 작업",
    ],
  },
  {
    space: "방 / 거실",
    icon: "🛋️",
    tasks: [
      "바닥 및 걸레받이 청소",
      "창틀, 새시 먼지 제거",
      "몰딩 및 문틀 청소",
      "스위치, 콘센트 주변 정리",
    ],
  },
  {
    space: "베란다",
    icon: "🪟",
    tasks: ["바닥 및 배수구 청소", "창문 및 방충망 청소", "벽면 먼지 제거"],
  },
  {
    space: "현관",
    icon: "🚪",
    tasks: ["바닥 및 신발장 청소", "중문/현관문 먼지 제거"],
  },
];

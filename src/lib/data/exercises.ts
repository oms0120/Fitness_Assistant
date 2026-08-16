import type { Exercise } from "./types";

export const exercises: Exercise[] = [
  // 胸 chest
  { id: "barbell-bench-press", name: "杠铃卧推", muscleGroup: "chest", equipment: "杠铃", difficulty: "intermediate", instructions: "平躺于卧推凳，双手略宽于肩握杠，下放至胸部轻触后推起。" },
  { id: "incline-dumbbell-press", name: "上斜哑铃卧推", muscleGroup: "chest", equipment: "哑铃", difficulty: "intermediate", instructions: "上斜凳约 30 度，双手持哑铃自胸部两侧向上推举。" },
  { id: "dumbbell-fly", name: "哑铃飞鸟", muscleGroup: "chest", equipment: "哑铃", difficulty: "beginner", instructions: "平躺持哑铃，双臂微屈自两侧向胸前合拢，感受胸肌拉伸与收缩。" },
  { id: "push-up", name: "俯卧撑", muscleGroup: "chest", equipment: "自重", difficulty: "beginner", instructions: "身体保持直线，屈肘下降至胸部接近地面后推起。" },
  // 肩 shoulder
  { id: "seated-dumbbell-press", name: "坐姿哑铃推举", muscleGroup: "shoulder", equipment: "哑铃", difficulty: "intermediate", instructions: "坐姿挺背，双手持哑铃自肩部向上推举至手臂伸直。" },
  { id: "dumbbell-lateral-raise", name: "哑铃侧平举", muscleGroup: "shoulder", equipment: "哑铃", difficulty: "beginner", instructions: "站立持哑铃，双臂微屈向两侧平举至与肩同高。" },
  { id: "overhead-press", name: "杠铃站姿推举", muscleGroup: "shoulder", equipment: "杠铃", difficulty: "advanced", instructions: "站立持杠于锁骨前，向上推举至头顶上方伸直。" },
  { id: "reverse-fly", name: "反向飞鸟", muscleGroup: "shoulder", equipment: "哑铃", difficulty: "beginner", instructions: "俯身持哑铃，双臂向两侧展开，锻炼三角肌后束。" },
  // 背 back
  { id: "pull-up", name: "引体向上", muscleGroup: "back", equipment: "自重", difficulty: "intermediate", instructions: "正握单杠，身体悬垂后向上拉起至下巴过杠。" },
  { id: "barbell-row", name: "杠铃划船", muscleGroup: "back", equipment: "杠铃", difficulty: "intermediate", instructions: "俯身挺背，持杠沿大腿方向拉至腹部。" },
  { id: "lat-pulldown", name: "高位下拉", muscleGroup: "back", equipment: "器械", difficulty: "beginner", instructions: "坐姿握横杆，向下拉至锁骨上方，控制回放。" },
  { id: "seated-cable-row", name: "坐姿划船", muscleGroup: "back", equipment: "器械", difficulty: "beginner", instructions: "坐姿握把手，向后拉至腹部，肩胛后缩。" },
  // 腿 legs
  { id: "barbell-squat", name: "深蹲", muscleGroup: "legs", equipment: "杠铃", difficulty: "intermediate", instructions: "杠铃置于上背，屈髋屈膝下蹲至大腿平行地面后站起。" },
  { id: "deadlift", name: "硬拉", muscleGroup: "legs", equipment: "杠铃", difficulty: "advanced", instructions: "屈髋俯身握杠，伸髋伸膝将杠铃拉起至直立。" },
  { id: "leg-press", name: "腿举", muscleGroup: "legs", equipment: "器械", difficulty: "beginner", instructions: "坐于腿举机，双脚蹬踏板，屈膝下放后蹬起。" },
  { id: "lunge", name: "箭步蹲", muscleGroup: "legs", equipment: "自重", difficulty: "beginner", instructions: "向前跨步下蹲，前膝约 90 度，交替进行。" },
  // 臂 arms
  { id: "barbell-curl", name: "杠铃弯举", muscleGroup: "arms", equipment: "杠铃", difficulty: "beginner", instructions: "站立持杠，屈肘将杠铃弯举至胸前。" },
  { id: "hammer-curl", name: "哑铃锤式弯举", muscleGroup: "arms", equipment: "哑铃", difficulty: "beginner", instructions: "持哑铃掌心相对，屈肘弯举，锻炼肱肌与前臂。" },
  { id: "cable-pushdown", name: "绳索下压", muscleGroup: "arms", equipment: "器械", difficulty: "beginner", instructions: "握绳索，肘固定，向下压至手臂伸直，锻炼肱三头肌。" },
  { id: "close-grip-bench-press", name: "窄距卧推", muscleGroup: "arms", equipment: "杠铃", difficulty: "intermediate", instructions: "窄握距卧推，下放至胸部，重点刺激肱三头肌。" },
];

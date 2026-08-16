import type { Recipe } from "./types";

export const recipes: Recipe[] = [
  // 减脂 cut
  { id: "chicken-broccoli", name: "鸡胸肉西兰花", category: "cut", calories: 320, proteinG: 42, carbsG: 15, fatG: 10, ingredients: ["鸡胸肉 150g", "西兰花 200g", "橄榄油 5g", "盐、黑胡椒适量"], steps: ["鸡胸肉切块用盐、黑胡椒腌制", "西兰花焯水", "热锅少油煎鸡胸肉至熟，与西兰花同炒"], tags: ["高蛋白", "低脂", "快手"] },
  { id: "steamed-fish-veggies", name: "清蒸鱼配蔬菜", category: "cut", calories: 280, proteinG: 35, carbsG: 10, fatG: 10, ingredients: ["鲈鱼 200g", "青菜 150g", "姜丝、葱适量", "蒸鱼豉油少许"], steps: ["鱼身划刀铺姜丝葱段", "水开后蒸 8 分钟", "青菜焯水摆盘，淋少许豉油"], tags: ["高蛋白", "低脂"] },
  { id: "shrimp-salad", name: "虾仁蔬菜沙拉", category: "cut", calories: 250, proteinG: 30, carbsG: 12, fatG: 8, ingredients: ["虾仁 150g", "生菜、番茄、黄瓜适量", "橄榄油 5g", "柠檬汁少许"], steps: ["虾仁焯水至熟", "蔬菜洗净切块", "混合后淋橄榄油与柠檬汁"], tags: ["低脂", "快手", "清爽"] },
  { id: "egg-white-oatmeal", name: "鸡蛋白燕麦粥", category: "cut", calories: 300, proteinG: 25, carbsG: 35, fatG: 6, ingredients: ["燕麦 40g", "鸡蛋白 4 个", "脱脂牛奶 200ml", "蓝莓少许"], steps: ["燕麦加牛奶煮至浓稠", "倒入鸡蛋白搅匀煮熟", "点缀蓝莓"], tags: ["高蛋白", "早餐"] },
  // 增肌 bulk
  { id: "beef-fried-rice", name: "牛肉炒饭", category: "bulk", calories: 550, proteinG: 30, carbsG: 60, fatG: 18, ingredients: ["牛肉末 120g", "米饭 200g", "鸡蛋 1 个", "胡萝卜、豌豆适量"], steps: ["牛肉末炒熟", "下米饭与蔬菜翻炒", "打入鸡蛋炒散调味"], tags: ["高碳水", "增肌"] },
  { id: "chicken-pasta", name: "鸡胸肉意面", category: "bulk", calories: 600, proteinG: 35, carbsG: 70, fatG: 15, ingredients: ["鸡胸肉 150g", "意面 100g（干重）", "番茄酱 50g", "橄榄油 8g"], steps: ["意面煮至八分熟", "鸡胸肉切条煎熟", "混合意面、鸡肉与番茄酱"], tags: ["高碳水", "增肌"] },
  { id: "salmon-mashed-potato", name: "三文鱼土豆泥", category: "bulk", calories: 580, proteinG: 32, carbsG: 45, fatG: 28, ingredients: ["三文鱼 150g", "土豆 250g", "牛奶 50ml", "黄油 5g"], steps: ["土豆蒸熟压泥，加牛奶黄油拌匀", "三文鱼煎至两面金黄", "组合装盘"], tags: ["高蛋白", "优质脂肪"] },
  { id: "beef-burger", name: "牛肉汉堡配薯条", category: "bulk", calories: 650, proteinG: 35, carbsG: 55, fatG: 30, ingredients: ["牛肉饼 120g", "汉堡胚 1 个", "土豆 150g", "生菜、番茄适量"], steps: ["牛肉饼煎熟", "土豆切条烤或煎至金黄", "组装汉堡配薯条"], tags: ["高热量", "增肌"] },
  // 均衡 balanced
  { id: "tomato-egg-rice", name: "番茄炒蛋配米饭", category: "balanced", calories: 450, proteinG: 18, carbsG: 55, fatG: 15, ingredients: ["番茄 2 个", "鸡蛋 2 个", "米饭 200g", "食用油 10g"], steps: ["鸡蛋炒散盛出", "番茄炒软后回锅鸡蛋", "配米饭"], tags: ["家常", "快手"] },
  { id: "chicken-veggie-stirfry", name: "清炒时蔬鸡丁", category: "balanced", calories: 400, proteinG: 28, carbsG: 20, fatG: 20, ingredients: ["鸡胸肉 120g", "彩椒、西兰花、胡萝卜适量", "食用油 10g", "蒜末适量"], steps: ["鸡丁腌制后炒熟", "蔬菜下锅快炒", "混合调味"], tags: ["高蛋白", "均衡"] },
  { id: "mixed-grain-chicken", name: "杂粮饭配烤鸡腿", category: "balanced", calories: 500, proteinG: 32, carbsG: 50, fatG: 18, ingredients: ["去皮鸡腿 1 个", "杂粮饭 180g", "西兰花 150g", "香料适量"], steps: ["鸡腿用香料腌制后烤熟", "杂粮饭煮熟", "配焯水西兰花"], tags: ["均衡", "高蛋白"] },
  { id: "tofu-noodle-soup", name: "豆腐菌菇汤面", category: "balanced", calories: 420, proteinG: 20, carbsG: 50, fatG: 14, ingredients: ["豆腐 150g", "面条 100g（干重）", "菌菇 100g", "青菜适量"], steps: ["菌菇煮汤底", "下豆腐与面条煮熟", "加青菜调味"], tags: ["清淡", "均衡"] },
];

/**
 * 业绩模块共享常量：枚举中文标签 + 子类清单 + 复核部门映射。
 * 路由与视图统一引用，避免散落硬编码。
 */

const CATEGORY_LABELS = {
  RESUME: "个人资历经历荣誉",
  TEACHING: "教学成果",
  RESEARCH: "科研业绩"
};

const CATEGORY_ORDER = ["RESUME", "TEACHING", "RESEARCH"];

// 每个大类的子类（subType 以中文存储，作为下拉项）
const SUBTYPES = {
  RESUME: [
    "工龄校龄",
    "多岗兼任",
    "辅导员班主任经历",
    "双师型证书",
    "荣誉奖励",
    "年度考核",
    "乡村振兴/援疆支教"
  ],
  TEACHING: [
    "教学工作量",
    "教学质量评价",
    "教师教学竞赛",
    "指导学生竞赛",
    "课程建设（一流/精品在线）",
    "专业教学资源库",
    "教学创新团队",
    "现代学徒制",
    "1+X 证书",
    "教学成果奖"
  ],
  RESEARCH: [
    "课题",
    "科研奖励",
    "论文",
    "论著/教材教参",
    "知识产权（专利/标准/软著）"
  ]
};

const LEVEL_LABELS = {
  NATIONAL: "国家级",
  PROVINCIAL: "省级",
  MUNICIPAL: "市厅级",
  SCHOOL: "校级",
  NONE: "无/不适用"
};

const LEVEL_ORDER = ["NATIONAL", "PROVINCIAL", "MUNICIPAL", "SCHOOL", "NONE"];

const RANK_LABELS = {
  SPECIAL: "特等",
  FIRST: "一等",
  SECOND: "二等",
  THIRD: "三等",
  NONE: "无/不分等次"
};

const RANK_ORDER = ["SPECIAL", "FIRST", "SECOND", "THIRD", "NONE"];

const REVIEW_STATUS_LABELS = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  PRELIM_REVIEWED: "初步复核",
  FINAL_REVIEWED: "最终复核",
  REJECTED: "已退回"
};

// 大类 → 默认复核部门（v1 由管理员统一复核，此处用于展示分流建议）
const REVIEW_DEPT_BY_CATEGORY = {
  RESUME: "组织人事处",
  TEACHING: "教务处",
  RESEARCH: "科研处"
};

const CREDENTIAL_TYPES = [
  "职称证",
  "教师资格证",
  "双师型证书",
  "学历证",
  "学位证",
  "执业资格证",
  "其他"
];

module.exports = {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  SUBTYPES,
  LEVEL_LABELS,
  LEVEL_ORDER,
  RANK_LABELS,
  RANK_ORDER,
  REVIEW_STATUS_LABELS,
  REVIEW_DEPT_BY_CATEGORY,
  CREDENTIAL_TYPES
};

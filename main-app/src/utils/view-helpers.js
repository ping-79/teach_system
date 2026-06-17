const dayjs = require("dayjs");
const { trimFloat } = require("./normalizers");

function formatDate(date, template = "YYYY-MM-DD") {
  return date ? dayjs(date).format(template) : "";
}

function eq(left, right) {
  return left === right;
}

module.exports = {
  formatDate,
  trimFloat,
  eq
};

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const row = target.closest("tr");
  if (!row) {
    return;
  }

  const hoursInput = row.querySelector('input[name*="[hours]"]');
  const theoryInput = row.querySelector('input[name*="[theoryHours]"]');
  const practiceInput = row.querySelector('input[name*="[practiceHours]"]');

  if (!(hoursInput instanceof HTMLInputElement) ||
      !(theoryInput instanceof HTMLInputElement) ||
      !(practiceInput instanceof HTMLInputElement)) {
    return;
  }

  const hours = Number(hoursInput.value || 0);
  const theory = Number(theoryInput.value || 0);
  const practice = Number(practiceInput.value || 0);

  if (target === hoursInput && !theoryInput.value && !practiceInput.value) {
    theoryInput.value = hours ? String(hours) : "";
  }

  if (target === theoryInput || target === practiceInput) {
    const total = theory + practice;
    hoursInput.value = total ? String(trimNumber(total)) : "";
  }

  syncSummaryFields();
});

document.addEventListener("DOMContentLoaded", () => {
  bindPlanActions();
  syncSummaryFields();
});

function bindPlanActions() {
  const table = document.querySelector("[data-plan-table]");
  if (!(table instanceof HTMLTableElement)) {
    return;
  }

  const addButton = document.querySelector("[data-plan-add-row]");
  const removeButton = document.querySelector("[data-plan-remove-row]");
  const printButton = document.querySelector("[data-plan-print-pdf]");

  addButton?.addEventListener("click", () => {
    appendPlanRow(table);
    syncSummaryFields();
  });

  removeButton?.addEventListener("click", () => {
    removePlanRow(table);
    syncSummaryFields();
  });

  printButton?.addEventListener("click", () => {
    window.print();
  });
}

function appendPlanRow(table) {
  const tbody = table.tBodies[0];
  if (!tbody) {
    return;
  }

  const lastRow = tbody.rows[tbody.rows.length - 1];
  const templateRow = lastRow ? lastRow.cloneNode(true) : buildFallbackRow(table.ownerDocument);

  resetRowFields(templateRow);
  tbody.appendChild(templateRow);
  reindexPlanRows(table);
}

function removePlanRow(table) {
  const tbody = table.tBodies[0];
  if (!tbody || tbody.rows.length <= 1) {
    return;
  }

  tbody.deleteRow(tbody.rows.length - 1);
  reindexPlanRows(table);
}

function resetRowFields(row) {
  row.querySelectorAll("input, textarea").forEach((field) => {
    field.value = "";
  });
}

function reindexPlanRows(table) {
  const tbody = table.tBodies[0];
  if (!tbody) {
    return;
  }

  Array.from(tbody.rows).forEach((row, index) => {
    const indexCell = row.querySelector(".row-index");
    if (indexCell) {
      indexCell.textContent = String(index + 1);
    }

    row.querySelectorAll("input, textarea").forEach((field) => {
      const name = field.getAttribute("name");
      if (name) {
        field.setAttribute("name", name.replace(/rows\[\d+\]/, `rows[${index}]`));
      }
    });
  });
}

function buildFallbackRow(document) {
  const row = document.createElement("tr");
  row.innerHTML = [
    '<td class="row-index">1</td>',
    '<td><input type="number" name="rows[0][weekIndex]"></td>',
    '<td><input type="text" name="rows[0][dateText]"></td>',
    '<td><input type="text" name="rows[0][periodText]"></td>',
    '<td><textarea name="rows[0][topicText]" rows="2"></textarea></td>',
    '<td><input type="number" step="0.5" name="rows[0][hours]"></td>',
    '<td><input type="number" step="0.5" name="rows[0][theoryHours]"></td>',
    '<td><input type="number" step="0.5" name="rows[0][practiceHours]"></td>'
  ].join("");
  return row;
}

function syncSummaryFields() {
  const totalInput = document.querySelector('input[name="totalHours"]');
  const theoryTotalInput = document.querySelector('input[name="theoryHours"]');
  const practiceTotalInput = document.querySelector('input[name="practiceHours"]');

  if (!(totalInput instanceof HTMLInputElement) ||
      !(theoryTotalInput instanceof HTMLInputElement) ||
      !(practiceTotalInput instanceof HTMLInputElement)) {
    return;
  }

  const rows = Array.from(document.querySelectorAll(".edit-table tbody tr"));
  let totalHours = 0;
  let theoryHours = 0;
  let practiceHours = 0;

  rows.forEach((row) => {
    const hoursInput = row.querySelector('input[name*="[hours]"]');
    const theoryInput = row.querySelector('input[name*="[theoryHours]"]');
    const practiceInput = row.querySelector('input[name*="[practiceHours]"]');
    const topicInput = row.querySelector('textarea[name*="[topicText]"]');
    const periodInput = row.querySelector('input[name*="[periodText]"]');

    if (!(hoursInput instanceof HTMLInputElement) ||
        !(theoryInput instanceof HTMLInputElement) ||
        !(practiceInput instanceof HTMLInputElement)) {
      return;
    }

    const hasContent = Boolean(
      Number(hoursInput.value || 0) ||
      Number(theoryInput.value || 0) ||
      Number(practiceInput.value || 0) ||
      topicInput?.value ||
      periodInput?.value
    );

    if (!hasContent) {
      return;
    }

    totalHours += Number(hoursInput.value || 0);
    theoryHours += Number(theoryInput.value || 0);
    practiceHours += Number(practiceInput.value || 0);
  });

  totalInput.value = totalHours ? String(trimNumber(totalHours)) : "";
  theoryTotalInput.value = theoryHours ? String(trimNumber(theoryHours)) : "";
  practiceTotalInput.value = practiceHours ? String(trimNumber(practiceHours)) : "";
}

function trimNumber(value) {
  return Number.isInteger(value) ? value : Number(value.toFixed(1));
}

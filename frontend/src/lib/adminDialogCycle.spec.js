import { ADMIN_DIALOGS, getAdminDialogKeyDirection, getNextAdminDialog } from "./adminDialogCycle.js";

test("cycles through openable Admin dialogs in both directions", () => {
  expect(ADMIN_DIALOGS).toHaveLength(12);
  expect(getNextAdminDialog("upload", 1)).toBe("telegram");
  expect(getNextAdminDialog("change-password", 1)).toBe("upload");
  expect(getNextAdminDialog("upload", -1)).toBe("change-password");
  expect(getNextAdminDialog("admin-configs", -1)).toBe("api-configuration");
  expect(getNextAdminDialog("fresh-pull", 1)).toBeNull();
  expect(getNextAdminDialog("broker-payments", 1)).toBeNull();
  expect(getNextAdminDialog("public-landing", 1)).toBeNull();
});

test("maps unmodified left and right arrows to dialog navigation", () => {
  expect(getAdminDialogKeyDirection({ key: "ArrowLeft" })).toBe(-1);
  expect(getAdminDialogKeyDirection({ key: "ArrowRight" })).toBe(1);
  expect(getAdminDialogKeyDirection({ key: "ArrowUp" })).toBeNull();
  expect(getAdminDialogKeyDirection({ key: "ArrowRight", ctrlKey: true })).toBeNull();
  expect(getAdminDialogKeyDirection({ key: "ArrowRight", defaultPrevented: true })).toBeNull();
});

test("does not take arrow keys away from editable controls", () => {
  const target = {
    isContentEditable: false,
    closest: jest.fn(() => true),
  };
  expect(getAdminDialogKeyDirection({ key: "ArrowRight", target })).toBeNull();
  expect(target.closest).toHaveBeenCalledWith(
    "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox'], [role='slider'], [role='spinbutton'], [role='tree'], [role='grid'], [role='menu'], [role='tablist']",
  );
  expect(getAdminDialogKeyDirection({ key: "ArrowLeft", target: { isContentEditable: true } })).toBeNull();
});

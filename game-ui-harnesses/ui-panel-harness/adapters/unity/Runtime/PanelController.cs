using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

namespace GameUi.PanelHarness
{
    [DisallowMultipleComponent]
    public sealed class PanelController : MonoBehaviour
    {
        public const string ADAPTER_VERSION = "0.1.2";
        private const double MAX_TICKS = 1000000;
        private const double DOUBLE_EPSILON = 2.2204460492503131E-16;
        [SerializeField] private PanelDocument document;
        [SerializeField] private PanelControlView[] views = new PanelControlView[0];
        private readonly Dictionary<string, PanelField> FIELDS = new Dictionary<string, PanelField>(StringComparer.Ordinal);
        private readonly Dictionary<string, PanelControlView> ROWS = new Dictionary<string, PanelControlView>(StringComparer.Ordinal);
        private readonly List<Action> DETACH = new List<Action>();
        private bool applying;
        private bool configured;

        public event Action<PanelHostEvent> EventRaised;
        public string LastError { get; private set; }
        public string PanelId { get { return document == null ? string.Empty : document.panelId; } }
        public string PanelSha256 { get { return document == null ? string.Empty : document.panelSha256; } }

        private void Awake() { Bind(); }
        private void OnEnable() { Bind(); }
        private void OnDisable() { Unbind(); }
        private void OnDestroy() { Unbind(); EventRaised = null; }

        public bool Configure(PanelDocument source, PanelControlView[] controlViews)
        {
            if (source == null || controlViews == null) return Fail("PANEL_CONFIG_REQUIRED");
            PanelDocument copy = JsonUtility.FromJson<PanelDocument>(JsonUtility.ToJson(source));
            string error;
            if (!Validate(copy, controlViews, out error)) return Fail(error);
            Unbind();
            document = copy;
            views = new PanelControlView[controlViews.Length];
            for (int index = 0; index < controlViews.Length; index++)
            {
                PanelControlView sourceView = controlViews[index];
                PanelControl definition = Array.Find(copy.controls, item => item.nodeId == sourceView.definition.nodeId);
                views[index] = new PanelControlView { definition = definition, slider = sourceView.slider, toggle = sourceView.toggle,
                    dropdown = sourceView.dropdown, button = sourceView.button, valueText = sourceView.valueText, progressFill = sourceView.progressFill };
            }
            configured = false;
            Bind();
            return configured;
        }

        private bool Fail(string error)
        {
            LastError = error;
            return false;
        }

        private static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }

        private static bool NumberValid(PanelField field, double value)
        {
            if (!Finite(value) || value < field.min || value > field.max) return false;
            double ticks = (value - field.min) / field.step;
            double rounded = Math.Floor(ticks + 0.5);
            double tolerance = Math.Min(1E-7, 16 * DOUBLE_EPSILON * Math.Max(1, Math.Abs(ticks)));
            return Finite(ticks) && rounded >= 0 && rounded <= MAX_TICKS && Math.Abs(ticks - rounded) <= tolerance;
        }

        private static bool ChoiceValid(PanelField field, string value)
        {
            return field.options != null && Array.Exists(field.options, option => option != null && option.id == value);
        }

        private static bool ProgressValid(PanelField field, double value)
        {
            return Finite(field.max) && field.max > 0 && Finite(value) && value >= 0 && value <= field.max;
        }

        private static bool Validate(PanelDocument source, PanelControlView[] controlViews, out string error)
        {
            error = "PANEL_RUNTIME_DOCUMENT";
            if (source.formatVersion != "0.1" || (source.adapterVersion != "0.1.0" && source.adapterVersion != "0.1.1" && source.adapterVersion != ADAPTER_VERSION) || string.IsNullOrEmpty(source.panelId)
                || source.fields == null || source.controls == null || source.fields.Length > 128 || source.controls.Length > 128
                || controlViews.Length != source.controls.Length) return false;
            Dictionary<string, PanelField> fields = new Dictionary<string, PanelField>(StringComparer.Ordinal);
            foreach (PanelField field in source.fields)
            {
                if (field == null || string.IsNullOrEmpty(field.id) || fields.ContainsKey(field.id)) return false;
                fields.Add(field.id, field);
                if (field.type == "number")
                {
                    if (!Finite(field.min) || !Finite(field.max) || !Finite(field.step) || field.min >= field.max || field.step <= 0
                        || !Finite(field.max - field.min) || !NumberValid(field, field.max) || !NumberValid(field, field.initialNumber)
                        || !NumberValid(field, field.numberValue)) return false;
                }
                else if (field.type == "progress")
                {
                    if (source.panelSpecVersion != "0.5" || source.adapterVersion != ADAPTER_VERSION || field.min != 0 || field.step != 0
                        || !ProgressValid(field, field.initialNumber) || !ProgressValid(field, field.numberValue)) return false;
                }
                else if (field.type == "enum")
                {
                    if (field.options == null || field.options.Length < 1 || field.options.Length > 8) return false;
                    HashSet<string> choices = new HashSet<string>(StringComparer.Ordinal);
                    foreach (PanelOption option in field.options)
                        if (option == null || string.IsNullOrEmpty(option.id) || string.IsNullOrEmpty(option.label) || !choices.Add(option.id)) return false;
                    if (!ChoiceValid(field, field.initialString) || !ChoiceValid(field, field.stringValue)) return false;
                }
                else if (field.type != "boolean") return false;
            }
            HashSet<string> rows = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> nodes = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> boundFields = new HashSet<string>(StringComparer.Ordinal);
            HashSet<string> events = new HashSet<string>(StringComparer.Ordinal);
            foreach (PanelControl control in source.controls)
            {
                if (control == null || string.IsNullOrEmpty(control.nodeId) || string.IsNullOrEmpty(control.rowId)
                    || !rows.Add(control.rowId) || !nodes.Add(control.nodeId)) return false;
                if (control.kind == "progress")
                {
                    if (control.eventName != "" || control.enabled || control.action != "" || control.resetFields == null || control.resetFields.Length != 0
                        || (control.displayMode != "percent" && control.displayMode != "value")) return false;
                }
                else if (string.IsNullOrEmpty(control.eventName) || !events.Add(control.eventName)) return false;
                PanelControlView view = Array.Find(controlViews, item => item != null && item.definition != null && item.definition.nodeId == control.nodeId);
                if (view == null) return false;
                if (control.kind == "button")
                {
                    if (view.button == null || (control.action != "emit" && control.action != "reset-initial") || control.resetFields == null) return false;
                    HashSet<string> resets = new HashSet<string>(StringComparer.Ordinal);
                    foreach (string fieldId in control.resetFields) if (!fields.ContainsKey(fieldId) || !resets.Add(fieldId)) return false;
                    if (control.action == "reset-initial" && resets.Count == 0) return false;
                    if (control.action == "emit" && resets.Count != 0) return false;
                }
                else
                {
                    PanelField field;
                    if (string.IsNullOrEmpty(control.fieldId) || !fields.TryGetValue(control.fieldId, out field) || !boundFields.Add(field.id)) return false;
                    if (control.kind == "slider")
                    {
                        if (field.type != "number" || view.slider == null || view.valueText == null || control.fractionDigits < 0 || control.fractionDigits > 6) return false;
                    }
                    else if (control.kind == "progress")
                    {
                        if (field.type != "progress" || (control.displayMode == "value" && field.max >= 1E21) || view.progressFill == null || view.progressFill.type != Image.Type.Filled
                            || view.progressFill.raycastTarget || view.progressFill.sprite == null || view.valueText == null
                            || control.fractionDigits < 0 || control.fractionDigits > 6) return false;
                    }
                    else if (control.kind == "switch") { if (field.type != "boolean" || view.toggle == null) return false; }
                    else if (control.kind == "select") { if (field.type != "enum" || view.dropdown == null) return false; }
                    else return false;
                }
            }
            if (boundFields.Count != fields.Count) return false;
            error = null;
            return true;
        }

        private void Bind()
        {
            Unbind();
            if (document == null) return;
            string error;
            if (views == null || !Validate(document, views, out error))
            {
                configured = false;
                LastError = "PANEL_RUNTIME_BIND_INVALID";
                Debug.LogError("PanelHarness cannot bind panel '" + PanelId + "': " + LastError, this);
                return;
            }
            FIELDS.Clear(); ROWS.Clear();
            foreach (PanelField field in document.fields) FIELDS.Add(field.id, field);
            foreach (PanelControlView view in views)
            {
                // Restore the canonical DTO even when Unity deserialized duplicate inline objects.
                view.definition = Array.Find(document.controls, item => item.nodeId == view.definition.nodeId);
                ROWS.Add(view.definition.rowId, view);
            }
            configured = true;
            ApplyViews();
            LastError = null;
            if (!isActiveAndEnabled) return;
            foreach (PanelControlView view in views)
            {
                PanelControlView ownedView = view;
                if (view.definition.kind == "slider")
                {
                    UnityAction<float> listener = value => SliderChanged(ownedView, value);
                    view.slider.onValueChanged.AddListener(listener);
                    DETACH.Add(() => { if (ownedView.slider != null) ownedView.slider.onValueChanged.RemoveListener(listener); });
                }
                else if (view.definition.kind == "switch")
                {
                    UnityAction<bool> listener = value => BooleanChanged(ownedView, value);
                    view.toggle.onValueChanged.AddListener(listener);
                    DETACH.Add(() => { if (ownedView.toggle != null) ownedView.toggle.onValueChanged.RemoveListener(listener); });
                }
                else if (view.definition.kind == "select")
                {
                    UnityAction<int> listener = value => ChoiceChanged(ownedView, value);
                    view.dropdown.onValueChanged.AddListener(listener);
                    DETACH.Add(() => { if (ownedView.dropdown != null) ownedView.dropdown.onValueChanged.RemoveListener(listener); });
                }
                else if (view.definition.kind == "button")
                {
                    UnityAction listener = () => Activate(ownedView.definition.rowId);
                    view.button.onClick.AddListener(listener);
                    DETACH.Add(() => { if (ownedView.button != null) ownedView.button.onClick.RemoveListener(listener); });
                }
            }
        }

        private void Unbind()
        {
            foreach (Action detach in DETACH) detach();
            DETACH.Clear();
        }

        private void ApplyViews()
        {
            applying = true;
            try
            {
                foreach (PanelControlView view in views)
                {
                    PanelControl control = view.definition;
                    PanelField field;
                    FIELDS.TryGetValue(control.fieldId ?? string.Empty, out field);
                    if (control.kind == "slider")
                    {
                        view.slider.minValue = 0;
                        view.slider.maxValue = (float)Math.Floor((field.max - field.min) / field.step + 0.5);
                        view.slider.wholeNumbers = true;
                        view.slider.interactable = control.enabled;
                        view.slider.SetValueWithoutNotify((float)Math.Floor((field.numberValue - field.min) / field.step + 0.5));
                        view.valueText.text = (control.prefix ?? string.Empty) + field.numberValue.ToString("F" + control.fractionDigits, CultureInfo.InvariantCulture) + (control.suffix ?? string.Empty);
                    }
                    else if (control.kind == "progress")
                    {
                        view.progressFill.fillAmount = (float)(field.numberValue / field.max);
                        double shown = control.displayMode == "percent" ? field.numberValue / field.max * 100 : field.numberValue;
                        view.valueText.text = shown.ToString("F" + control.fractionDigits, CultureInfo.InvariantCulture)
                            + (control.displayMode == "percent" ? "%" : "");
                    }
                    else if (control.kind == "switch")
                    {
                        view.toggle.interactable = control.enabled;
                        view.toggle.SetIsOnWithoutNotify(field.booleanValue);
                    }
                    else if (control.kind == "select")
                    {
                        view.dropdown.interactable = control.enabled;
                        bool rebuild = view.dropdown.options.Count != field.options.Length;
                        for (int index = 0; !rebuild && index < field.options.Length; index++) rebuild = view.dropdown.options[index].text != field.options[index].label;
                        if (rebuild)
                        {
                            view.dropdown.ClearOptions();
                            List<string> labels = new List<string>();
                            foreach (PanelOption option in field.options) labels.Add(option.label);
                            view.dropdown.AddOptions(labels);
                        }
                        view.dropdown.SetValueWithoutNotify(Array.FindIndex(field.options, option => option.id == field.stringValue));
                        view.dropdown.RefreshShownValue();
                    }
                    else view.button.interactable = control.enabled;
                }
            }
            finally { applying = false; }
        }

        private bool AcceptInput(PanelControlView view)
        {
            if (applying || !configured || !isActiveAndEnabled) return false;
            if (!view.definition.enabled) { ApplyViews(); return false; }
            return true;
        }

        private void SliderChanged(PanelControlView view, float index)
        {
            if (!AcceptInput(view)) return;
            PanelField field = FIELDS[view.definition.fieldId];
            double ticks = Math.Max(0, Math.Min(Math.Floor((field.max - field.min) / field.step + 0.5), Math.Floor(index + 0.5)));
            double value = ticks == Math.Floor((field.max - field.min) / field.step + 0.5) ? field.max : field.min + ticks * field.step;
            if (!NumberValid(field, value)) { ApplyViews(); Fail("PANEL_USER_NUMBER_INVALID:" + field.id); return; }
            bool changed = field.numberValue != value;
            field.numberValue = value;
            ApplyViews();
            if (changed) Raise(view.definition, field);
        }

        private void BooleanChanged(PanelControlView view, bool value)
        {
            if (!AcceptInput(view)) return;
            PanelField field = FIELDS[view.definition.fieldId];
            bool changed = field.booleanValue != value;
            field.booleanValue = value;
            if (changed) Raise(view.definition, field);
        }

        private void ChoiceChanged(PanelControlView view, int index)
        {
            if (!AcceptInput(view)) return;
            PanelField field = FIELDS[view.definition.fieldId];
            if (index < 0 || index >= field.options.Length) { ApplyViews(); Fail("PANEL_USER_CHOICE_INVALID:" + field.id); return; }
            string value = field.options[index].id;
            bool changed = field.stringValue != value;
            field.stringValue = value;
            if (changed) Raise(view.definition, field);
        }

        public bool SetNumber(string fieldId, double value)
        {
            PanelField field;
            if (!configured || fieldId == null || !FIELDS.TryGetValue(fieldId, out field) || field.type != "number" || !NumberValid(field, value)) return Fail("PANEL_NUMBER_INVALID:" + fieldId);
            field.numberValue = value; ApplyViews(); LastError = null; return true;
        }

        public bool SetBoolean(string fieldId, bool value)
        {
            PanelField field;
            if (!configured || fieldId == null || !FIELDS.TryGetValue(fieldId, out field) || field.type != "boolean") return Fail("PANEL_BOOLEAN_INVALID:" + fieldId);
            field.booleanValue = value; ApplyViews(); LastError = null; return true;
        }

        public bool SetProgress(string fieldId, double value)
        {
            PanelField field;
            if (!configured || fieldId == null || !FIELDS.TryGetValue(fieldId, out field) || field.type != "progress" || !ProgressValid(field, value)) return Fail("PANEL_PROGRESS_INVALID:" + fieldId);
            field.numberValue = value; ApplyViews(); LastError = null; return true;
        }

        public bool SetChoice(string fieldId, string value)
        {
            PanelField field;
            if (!configured || fieldId == null || !FIELDS.TryGetValue(fieldId, out field) || field.type != "enum" || !ChoiceValid(field, value)) return Fail("PANEL_CHOICE_INVALID:" + fieldId);
            field.stringValue = value; ApplyViews(); LastError = null; return true;
        }

        public bool SetState(PanelStateValue[] values)
        {
            if (!configured || values == null || values.Length != FIELDS.Count) return Fail("PANEL_STATE_SHAPE");
            HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (PanelStateValue value in values)
            {
                PanelField field;
                if (value == null || value.fieldId == null || !seen.Add(value.fieldId) || !FIELDS.TryGetValue(value.fieldId, out field) || value.type != field.type
                    || (field.type == "number" && !NumberValid(field, value.numberValue)) || (field.type == "progress" && !ProgressValid(field, value.numberValue))
                    || (field.type == "enum" && !ChoiceValid(field, value.stringValue))) return Fail("PANEL_STATE_VALUE");
            }
            foreach (PanelStateValue value in values)
            {
                PanelField field = FIELDS[value.fieldId];
                if (field.type == "number" || field.type == "progress") field.numberValue = value.numberValue;
                else if (field.type == "boolean") field.booleanValue = value.booleanValue;
                else field.stringValue = value.stringValue;
            }
            ApplyViews(); LastError = null; return true;
        }

        public PanelStateValue[] GetState()
        {
            if (!configured) return new PanelStateValue[0];
            PanelStateValue[] result = new PanelStateValue[document.fields.Length];
            for (int index = 0; index < result.Length; index++)
            {
                PanelField field = document.fields[index];
                result[index] = new PanelStateValue { fieldId = field.id, type = field.type, numberValue = field.numberValue, booleanValue = field.booleanValue, stringValue = field.stringValue };
            }
            return result;
        }

        public string GetStateJson()
        {
            StringBuilder result = new StringBuilder("{");
            PanelStateValue[] values = GetState();
            for (int index = 0; index < values.Length; index++)
            {
                if (index > 0) result.Append(',');
                PanelStateValue value = values[index];
                WriteJsonString(result, value.fieldId); result.Append(':');
                if (value.type == "number" || value.type == "progress") result.Append(value.numberValue.ToString("R", CultureInfo.InvariantCulture));
                else if (value.type == "boolean") result.Append(value.booleanValue ? "true" : "false");
                else WriteJsonString(result, value.stringValue);
            }
            return result.Append('}').ToString();
        }

        private static void WriteJsonString(StringBuilder result, string value)
        {
            result.Append('"');
            foreach (char character in value ?? string.Empty)
            {
                if (character == '"' || character == '\\') result.Append('\\').Append(character);
                else if (character < 32) result.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                else result.Append(character);
            }
            result.Append('"');
        }

        public bool Activate(string rowId)
        {
            PanelControlView view;
            if (!configured || !isActiveAndEnabled || rowId == null || !ROWS.TryGetValue(rowId, out view) || view.definition.kind != "button" || !view.definition.enabled) return Fail("PANEL_ACTION_DISABLED_OR_UNKNOWN:" + rowId);
            PanelControl control = view.definition;
            if (control.action == "reset-initial")
            {
                foreach (string fieldId in control.resetFields)
                {
                    PanelField field = FIELDS[fieldId];
                    if (field.type == "number" || field.type == "progress") field.numberValue = field.initialNumber;
                    else if (field.type == "boolean") field.booleanValue = field.initialBoolean;
                    else field.stringValue = field.initialString;
                }
                ApplyViews();
            }
            LastError = null;
            Raise(control, null);
            return true;
        }

        private void Raise(PanelControl control, PanelField field)
        {
            Action<PanelHostEvent> callback = EventRaised;
            if (callback == null) return;
            callback(new PanelHostEvent { Name = control.eventName, RowId = control.rowId, FieldId = field == null ? string.Empty : field.id,
                Action = field == null ? control.action : string.Empty, ValueType = field == null ? string.Empty : field.type,
                NumberValue = field == null ? 0 : field.numberValue, BooleanValue = field != null && field.booleanValue,
                StringValue = field == null ? string.Empty : field.stringValue, State = GetState(), StateJson = GetStateJson() });
        }
    }
}

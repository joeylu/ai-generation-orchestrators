using System;

namespace GameUi.PanelHarness
{
    // Public fields are the versioned JsonUtility interchange contract.
    [Serializable]
    public sealed class PanelDocument
    {
        public string formatVersion, adapterVersion, panelId, panelSha256, panelSpecVersion;
        public float canvasWidth, canvasHeight;
        public PanelNode[] nodes;
        public PanelField[] fields;
        public PanelControl[] controls;
        public PanelAsset[] assets;
    }

    [Serializable]
    public sealed class PanelNode
    {
        public string id, parentId, type;
        public float x, y, width, height;
        public string backgroundColor, borderColor, textColor;
        public float borderWidth, cornerRadius, opacity;
        public int fontSize;
        public bool bold, drawBackground;
        public string text, source, fit;
        public string textAlignment; // Explicit anchor for the title or a declared slider value.
        public string tabActiveColor, tabActiveTextColor, tabIndicatorColor; // Optional themed header, absent in legacy documents.
        public bool hasRegion;
        public float regionX, regionY, regionWidth, regionHeight;
        public float contentWidth, contentHeight;
    }

    [Serializable]
    public sealed class PanelField
    {
        public string id, type;
        public double min, max, step, initialNumber, numberValue;
        public bool initialBoolean, booleanValue;
        public string initialString, stringValue;
        public PanelOption[] options;
        public int maxLength;
    }

    [Serializable]
    public sealed class PanelOption
    {
        public string id, label;
    }

    [Serializable]
    public sealed class PanelControl
    {
        public string nodeId, rowId, kind, fieldId, eventName;
        public bool enabled;
        public string action;
        public string[] resetFields, submitFields;
        public string placeholder, inputType, requiredErrorTextId, minLengthErrorTextId;
        public bool readOnly;
        public bool deferEmptyError;
        public PanelInputValidation validation;
        public string valueTextId, prefix, suffix;
        public string displayMode;
        public string[] contentIds;
        public int fractionDigits;
    }

    [Serializable]
    public sealed class PanelInputValidation
    {
        public bool required;
        public int minLength;
        public string requiredMessage, minLengthMessage;
    }

    [Serializable]
    public sealed class PanelAsset
    {
        public string path, sha256;
        public long bytes;
        public int width, height;
    }

    [Serializable]
    public sealed class PanelStateValue
    {
        public string fieldId, type;
        public double numberValue;
        public bool booleanValue;
        public string stringValue;
    }

    public sealed class PanelHostEvent
    {
        public string Name { get; internal set; }
        public string RowId { get; internal set; }
        public string FieldId { get; internal set; }
        public string Action { get; internal set; }
        public string ValueType { get; internal set; }
        public double NumberValue { get; internal set; }
        public bool BooleanValue { get; internal set; }
        public string StringValue { get; internal set; }
        public string StateJson { get; internal set; }
        public PanelStateValue[] State { get; internal set; }
        public System.Collections.Generic.Dictionary<string, string> Values { get; internal set; }
    }
}

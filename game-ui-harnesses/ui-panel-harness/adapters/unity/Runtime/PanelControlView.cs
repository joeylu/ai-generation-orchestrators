using System;
using UnityEngine.UI;
using UnityEngine;

namespace GameUi.PanelHarness
{
    [Serializable]
    public sealed class PanelControlView
    {
        public PanelControl definition;
        public Slider slider;
        public Toggle toggle;
        public Dropdown dropdown;
        public Button button;
        public InputField input;
        public Text requiredErrorText, minLengthErrorText;
        public Image progressFill;
        public Text valueText;
        public Button[] tabButtons;
        public GameObject[] tabPages;
        public Color tabActiveColor, tabIdleColor;
    }
}

using System;
using UnityEngine.UI;

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
        public Image progressFill;
        public Text valueText;
    }
}

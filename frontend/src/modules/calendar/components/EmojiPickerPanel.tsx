import EmojiPicker, { Theme } from 'emoji-picker-react';

type EmojiPickerPanelProps = {
    onPick: (emoji: string) => void;
};

export default function EmojiPickerPanel({ onPick }: EmojiPickerPanelProps) {
    return (
        <EmojiPicker
            theme={Theme.DARK}
            onEmojiClick={(picked) => {
                onPick(picked.emoji);
            }}
        />
    );
}

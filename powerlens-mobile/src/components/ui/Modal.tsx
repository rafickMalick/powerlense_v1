import { Modal as RNModal, View, Text, Pressable, ScrollView, type GestureResponderEvent } from 'react-native';

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({ visible, onClose, title, description, children, footer }: ModalProps) {
  const stop = (e: GestureResponderEvent) => e.stopPropagation();

  return (
    <RNModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-gray-900/40 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface border border-border rounded-t-2xl p-4 max-h-[85%] shadow-elevated"
          onPress={stop}
        >
          {title && <Text className="text-text-primary text-lg font-semibold mb-1">{title}</Text>}
          {description && <Text className="text-text-secondary text-sm mb-4">{description}</Text>}
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
          {footer && <View className="mt-4">{footer}</View>}
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

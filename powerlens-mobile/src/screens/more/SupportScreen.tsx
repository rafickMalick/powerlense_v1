import { View, Text, ScrollView, Linking, Pressable } from 'react-native';
import { Mail, MessageCircle, LifeBuoy } from 'lucide-react-native';
import { Card } from '@/components/ui';
import { palette } from '@/theme/colors';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

const SUPPORT_EMAIL = 'support@powerlens.local';

const FAQ_ITEMS = [
  {
    question: "L'application affiche \"Hors ligne\", que faire ?",
    answer:
      "Vérifiez la connexion WiFi de votre appareil et l'état du broker MQTT/backend. Les commandes sont désactivées tant que la connexion temps réel n'est pas rétablie, pour éviter tout faux positif.",
  },
  {
    question: 'Le badge "Simulation" est-il normal ?',
    answer:
      "Il indique que les mesures affichées proviennent du simulateur (aucun module ESP32 réel détecté depuis 30s). Dès qu'un module physique publie à nouveau, le badge disparaît automatiquement.",
  },
  {
    question: 'Comment contester une action tracée dans l\'historique ?',
    answer:
      "Toutes les actions (manuelles ou automatiques) sont journalisées de façon non modifiable — contactez un administrateur pour toute clarification, l'historique complet est consultable via Rapports.",
  },
];

export function SupportScreen() {
  useScreenViewLogging('Support');

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card>
        <View className="flex-row items-center gap-3 mb-3">
          <LifeBuoy color={palette.navy700} size={20} />
          <Text className="text-base font-semibold text-text-primary">Besoin d'aide ?</Text>
        </View>
        <Text className="text-sm text-text-secondary leading-relaxed mb-4">
          Notre équipe support peut vous aider pour toute question sur le fonctionnement de PowerLens,
          la configuration des règles, ou un incident matériel.
        </Text>
        <Pressable
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          className="flex-row items-center gap-3 p-3 bg-surface-alt rounded active:bg-surface-secondary"
        >
          <Mail color={palette.navy700} size={16} />
          <Text className="text-sm text-primary font-medium">{SUPPORT_EMAIL}</Text>
        </Pressable>
      </Card>

      <Card>
        <View className="flex-row items-center gap-3 mb-3">
          <MessageCircle color={palette.navy700} size={20} />
          <Text className="text-sm font-medium text-text-secondary">QUESTIONS FRÉQUENTES</Text>
        </View>
        <View className="gap-4">
          {FAQ_ITEMS.map((item) => (
            <View key={item.question}>
              <Text className="text-sm font-medium text-text-primary mb-1">{item.question}</Text>
              <Text className="text-xs text-text-secondary leading-relaxed">{item.answer}</Text>
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}

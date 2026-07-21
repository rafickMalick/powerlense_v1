import { Component, type ReactNode } from 'react';
import { View, Text, Pressable } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { palette } from '@/theme/colors';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: palette.gray50,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
          }}
        >
          <AlertTriangle color={palette.danger} size={48} />
          <Text style={{ color: palette.gray900, fontSize: 18, fontWeight: 'bold', marginTop: 16 }}>
            Erreur inattendue
          </Text>
          <Text
            style={{
              color: palette.gray500,
              fontSize: 14,
              textAlign: 'center',
              marginTop: 8,
              lineHeight: 20,
            }}
          >
            {this.state.error?.message ?? "L'application a rencontré un problème."}
          </Text>
          <Pressable
            onPress={this.handleRetry}
            style={{
              marginTop: 24,
              backgroundColor: palette.navy700,
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: palette.white, fontWeight: '600' }}>Réessayer</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

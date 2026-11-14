import React from 'react';
import ErrorScreen from './ErrorScreen.jsx';
export default class AppBoundary extends React.Component {
  state = { error: null, generation: 0 };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('EarthTrends rendering failed', error); }
  render() {
    if (this.state.error) return <ErrorScreen message="Something interrupted EarthTrends. Try again. If the globe still cannot open, use a browser with WebGL 2 support." onRetry={() => this.setState(s => ({ error: null, generation: s.generation + 1 }))} />;
    return <React.Fragment key={this.state.generation}>{this.props.children}</React.Fragment>;
  }
}

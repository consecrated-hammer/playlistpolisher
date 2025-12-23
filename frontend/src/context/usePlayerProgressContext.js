import { useContext } from 'react';
import PlayerProgressContext from './playerProgressContextBase';

const usePlayerProgressContext = () => {
  return useContext(PlayerProgressContext);
};

export default usePlayerProgressContext;

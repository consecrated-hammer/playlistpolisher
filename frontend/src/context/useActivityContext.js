import { useContext } from 'react';
import ActivityContext from './activityContextBase';

const useActivityContext = () => {
  return useContext(ActivityContext);
};

export default useActivityContext;

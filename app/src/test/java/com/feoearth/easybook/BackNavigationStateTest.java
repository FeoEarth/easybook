package com.feoearth.easybook;
import org.junit.Test;
import static org.junit.Assert.*;
public class BackNavigationStateTest {
 @Test public void unknownAndPendingNeverExit(){BackNavigationState s=new BackNavigationState();assertTrue(s.intercept());assertEquals(0,s.begin(0));s.update(1,true);long token=s.begin(1);assertTrue(token>0);assertEquals(0,s.begin(1));s.update(2,false);assertTrue(s.intercept());assertFalse(s.finish(token+1));assertTrue(s.finish(token));assertFalse(s.intercept());}
 @Test public void staleGesturesAndMessagesAreRejected(){BackNavigationState s=new BackNavigationState();s.update(3,true);assertFalse(s.update(2,false));assertEquals(0,s.begin(2));assertTrue(s.intercept());}
 @Test public void reloadInvalidatesPendingAck(){BackNavigationState s=new BackNavigationState();s.update(1,true);long old=s.begin(1);s.reset();assertFalse(s.finish(old));assertTrue(s.intercept());s.update(1,true);long fresh=s.begin(1);assertNotEquals(old,fresh);assertFalse(s.finish(old));assertTrue(s.finish(fresh));}
 @Test public void rootDoesNotRegisterCallback(){BackNavigationState s=new BackNavigationState();s.update(1,false);assertFalse(s.intercept());assertEquals(0,s.begin(1));}
}

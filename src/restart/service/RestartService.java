package restart.service;

import javax.ejb.Stateless;
import javax.enterprise.inject.Default;

@Default
@Stateless
public class RestartService implements IRestartService {

	@Override
	public String getData() {
		return "asdasdasdas";
	}
	
	@Override
	public void close() throws Exception {
		// TODO Auto-generated method stub

	}

}

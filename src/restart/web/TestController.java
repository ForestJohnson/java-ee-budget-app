package restart.web;

import javax.ejb.Stateless;
import javax.inject.Inject;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;

import restart.service.IRestartService;

@Stateless
@Path("test")
public class TestController {
	
	@Inject private IRestartService restartService;
	
    @GET
    @Produces("text/html")
    @Path("{testId}")
    public String get(@PathParam("testId") int testId) {
        return "<html lang=\"en\"><body><h1>"
        		+ restartService.getData(testId).toString()
        		+"</h1></body></html>";
    }
	
}
